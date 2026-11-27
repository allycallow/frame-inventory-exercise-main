package com.global.ct.frameinventory.frame;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import javax.sql.DataSource;

import com.google.protobuf.Empty;
import com.google.protobuf.InvalidProtocolBufferException;
import com.google.rpc.BadRequest;
import com.google.rpc.ErrorInfo;
import io.grpc.Metadata;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.protobuf.StatusProto;
import io.grpc.stub.MetadataUtils;
import io.micrometer.core.instrument.MeterRegistry;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.function.Executable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.grpc.client.GrpcChannelFactory;
import org.springframework.grpc.test.AutoConfigureInProcessTransport;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import com.global.ct.frameinventory.grpc.v1.CreateFrameRequest;
import com.global.ct.frameinventory.grpc.v1.DeleteFrameRequest;
import com.global.ct.frameinventory.grpc.v1.Frame;
import com.global.ct.frameinventory.grpc.v1.FrameData;
import com.global.ct.frameinventory.grpc.v1.FrameFormat;
import com.global.ct.frameinventory.grpc.v1.FrameLocation;
import com.global.ct.frameinventory.grpc.v1.FrameManagementGrpc;
import com.global.ct.frameinventory.grpc.v1.GetFrameHistoryRequest;
import com.global.ct.frameinventory.grpc.v1.GetFrameRequest;
import com.global.ct.frameinventory.grpc.v1.ListFramesRequest;
import com.global.ct.frameinventory.grpc.v1.UpdateFrameRequest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertThrows;

@SpringBootTest(properties = "logging.level.com.global.ct.frameinventory.frame=DEBUG")
@AutoConfigureInProcessTransport
@Testcontainers
class FrameGrpcTests {
    private static final String FRAME_ID = "FRM-1";
    private static final String MISSING = "The frame was not found.";
    private static final String STALE = "The frame has changed. Fetch its current version before retrying.";
    private static final String RETIRED = "The frame no longer has a current version.";
    private static final String RESERVED = "This frame ID has already been used.";

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18.6");

    private final FrameManagementGrpc.FrameManagementBlockingStub client;
    private final JdbcClient jdbc;
    private final DataSource dataSource;
    private final FrameService service;
    private final TransactionTemplate transactions;
    private final MeterRegistry meters;

    @Autowired
    FrameGrpcTests(
        GrpcChannelFactory channels, JdbcClient jdbc, DataSource dataSource, FrameService service,
        TransactionTemplate transactions, MeterRegistry meters
    ) {
        this.client = FrameManagementGrpc.newBlockingStub(channels.createChannel("local"));
        this.jdbc = jdbc;
        this.dataSource = dataSource;
        this.service = service;
        this.transactions = transactions;
        this.meters = meters;
    }

    @BeforeEach
    void resetInventory() {
        jdbc.sql("TRUNCATE frame, region, frame_format RESTART IDENTITY CASCADE").update();
    }

    @Test
    void createsEditsAndDeletesAFrameWhileKeepingItsHistoryAndId() throws Exception {
        Frame created = create(FRAME_ID);
        long firstVersion = created.getVersionId();
        assertThat(created.getCurrent()).isTrue();
        assertThat(created.getChangeSource()).isEqualTo("MANUAL_CREATE");
        assertThat(created.hasValidTo()).isFalse();

        var alreadyExists = assertError(Status.Code.ALREADY_EXISTS, RESERVED, () -> create(FRAME_ID));
        assertThat(info(alreadyExists).getReason()).isEqualTo("FRAME_ID_RESERVED");

        Frame current = get(FRAME_ID);
        assertThat(current.getVersionId()).isEqualTo(firstVersion);
        assertThat(current.getAttributes().getLocation().getPostcode()).isEqualTo("SW1A 1AA");
        assertThat(current.getAttributes().getFormat().getSizeGroupCode()).isEqualTo("006");
        assertThat(current.getAttributes().getLatitude()).isEqualTo("51.501");
        assertThat(current.getAttributes().getLongitude()).isEqualTo("-0.142");

        Frame edited = client.updateFrame(edit(FRAME_ID, firstVersion, "MAINTENANCE"));
        long secondVersion = edited.getVersionId();
        assertThat(secondVersion).isNotEqualTo(firstVersion);
        assertThat(edited.getChangeSource()).isEqualTo("MANUAL_EDIT");
        assertThat(edited.getAttributes().hasLocation()).isFalse();

        var stale = assertError(Status.Code.ABORTED, STALE,
            () -> client.updateFrame(edit(FRAME_ID, firstVersion, "BLOCKED")));
        assertThat(info(stale).getReason()).isEqualTo("STALE_FRAME_VERSION");
        assertThat(info(stale).getMetadataMap()).containsEntry("currentVersionId", Long.toString(secondVersion));

        assertError(Status.Code.ABORTED, STALE, () -> delete(FRAME_ID, firstVersion));
        assertThat(delete(FRAME_ID, secondVersion)).isEqualTo(Empty.getDefaultInstance());
        assertThat(delete(FRAME_ID, null)).isEqualTo(Empty.getDefaultInstance());
        assertError(Status.Code.ABORTED, RETIRED, () -> delete(FRAME_ID, secondVersion));
        assertError(Status.Code.NOT_FOUND, MISSING, () -> get(FRAME_ID));
        assertThat(client.listFrames(ListFramesRequest.getDefaultInstance()).getItemsList()).isEmpty();

        var versions = history(FRAME_ID);
        assertThat(versions).extracting(Frame::getVersionId).containsExactly(secondVersion, firstVersion);
        Frame closed = versions.getFirst();
        Frame first = versions.getLast();
        assertThat(closed.getAttributes().getStatus()).isEqualTo("MAINTENANCE");
        assertThat(closed.getCurrent()).isFalse();
        assertThat(closed.getChangeSource()).isEqualTo("MANUAL_EDIT");
        assertThat(closed.getClosedByChangeSource()).isEqualTo("MANUAL_DELETE");
        assertThat(first.getChangeSource()).isEqualTo("MANUAL_CREATE");
        assertThat(first.hasClosedByChangeSource()).isFalse();
        assertThat(first.getValidTo()).isEqualTo(closed.getValidFrom());
        assertThat(closed.hasValidTo()).isTrue();

        assertError(Status.Code.ALREADY_EXISTS, RESERVED, () -> create(FRAME_ID));
    }

    @Test
    void listsCurrentFramesInStablePages() {
        create("FRM-3");
        create(FRAME_ID);
        create("FRM-2");
        delete("FRM-2", null);

        assertThat(history("FRM-2")).singleElement().satisfies(frame -> {
            assertThat(frame.getChangeSource()).isEqualTo("MANUAL_CREATE");
            assertThat(frame.getClosedByChangeSource()).isEqualTo("MANUAL_DELETE");
        });

        var defaults = client.listFrames(ListFramesRequest.getDefaultInstance());
        assertThat(defaults.getSize()).isEqualTo(25);
        assertThat(defaults.getItemsList()).extracting(Frame::getFrameId).containsExactly(FRAME_ID, "FRM-3");

        var first = client.listFrames(ListFramesRequest.newBuilder().setSize(1).build());
        assertThat(first.getItemsList()).extracting(Frame::getFrameId).containsExactly(FRAME_ID);
        assertThat(first.getHasNext()).isTrue();
        var second = client.listFrames(ListFramesRequest.newBuilder().setPage(1).setSize(1).build());
        assertThat(second.getItemsList()).extracting(Frame::getFrameId).containsExactly("FRM-3");
        assertThat(second.getHasNext()).isFalse();
        var far = client.listFrames(ListFramesRequest.newBuilder().setPage(Integer.MAX_VALUE).setSize(50).build());
        assertThat(far.getItemsList()).isEmpty();
        assertThat(far.getHasNext()).isFalse();
    }

    @Test
    void filtersCurrentFramesByStatusAndSearchBeforePaginating() {
        var idMatch = create("FRM-LONDON");
        client.updateFrame(edit(idMatch.getFrameId(), idMatch.getVersionId(), "PENDING"));
        create("FRM-1");
        var blocked = create("FRM-2");
        client.updateFrame(edit(blocked.getFrameId(), blocked.getVersionId(), "BLOCKED").toBuilder()
            .setAttributes(blocked.getAttributes().toBuilder().setStatus("BLOCKED"))
            .build());
        create("FRM-3");
        delete("FRM-3", null);
        client.createFrame(CreateFrameRequest.newBuilder().setFrameId("FRM-4")
            .setAttributes(FrameData.newBuilder().setStatus("LIVE")).build());

        var request = ListFramesRequest.newBuilder().addStatuses("LIVE").addStatuses("PENDING")
            .setSearch("  LoNd  ").setSize(1);
        var first = client.listFrames(request.build());
        assertThat(first.getItemsList()).extracting(Frame::getFrameId).containsExactly("FRM-1");
        assertThat(first.getHasNext()).isTrue();
        var second = client.listFrames(request.setPage(1).build());
        assertThat(second.getItemsList()).extracting(Frame::getFrameId).containsExactly("FRM-LONDON");
        assertThat(second.getHasNext()).isFalse();

        assertThat(client.listFrames(ListFramesRequest.newBuilder().addStatuses("LIVE").setSearch(" ").build())
            .getItemsList()).extracting(Frame::getFrameId).containsExactly("FRM-1", "FRM-4");
        assertThat(client.listFrames(ListFramesRequest.newBuilder().setSearch("lond").build()).getItemsList())
            .extracting(Frame::getFrameId).containsExactly("FRM-1", "FRM-2", "FRM-LONDON");
    }

    @Test
    void searchesForPatternCharactersLiterally() {
        create("FRM-%");
        create("FRM-_");
        create("FRM-!");
        create("FRM-X");

        for (var character : List.of("%", "_", "!")) {
            var results = client.listFrames(ListFramesRequest.newBuilder().setSearch(character).build());
            assertThat(results.getItemsList()).extracting(Frame::getFrameId).containsExactly("FRM-" + character);
        }
    }

    @Test
    void rejectsNullCharactersInListFilters() throws Exception {
        assertThat(invalidFields(() -> client.listFrames(ListFramesRequest.newBuilder().setSearch("\0").build())))
            .containsExactly("search");
        assertError(Status.Code.INVALID_ARGUMENT, "One or more request values are invalid.",
            () -> client.listFrames(ListFramesRequest.newBuilder().addStatuses("LIVE\0").build()));
    }

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void logsUnexpectedRpcFailureWithCorrelationIdAndCause(CapturedOutput output) {
        var correlationId = "069aa868-7443-4787-8b47-e56fbc6077dd";
        var headers = new Metadata();
        headers.put(Metadata.Key.of("x-correlation-id", Metadata.ASCII_STRING_MARSHALLER), correlationId);
        var correlatedClient = client.withInterceptors(MetadataUtils.newAttachHeadersInterceptor(headers));

        jdbc.sql("ALTER TABLE frame_version RENAME TO unavailable_frame_version").update();
        try {
            var failure = assertThrows(StatusRuntimeException.class,
                () -> correlatedClient.listFrames(ListFramesRequest.getDefaultInstance()));
            assertThat(failure.getStatus().getCode()).isEqualTo(Status.Code.UNKNOWN);
        } finally {
            jdbc.sql("ALTER TABLE unavailable_frame_version RENAME TO frame_version").update();
        }

        assertThat(output.getOut().lines().toList()).anySatisfy(line -> assertThat(line).contains(
            "\"message\":\"grpc.server_error\"", "\"level\":\"ERROR\"", "\"grpcStatus\":\"UNKNOWN\"",
            "ListFrames", "\"correlationId\":\"" + correlationId + "\"", "PSQLException"
        ));
    }

    @Test
    @ExtendWith(OutputCaptureExtension.class)
    void recordsCommittedLifecycleEventsAndLogsTheFullCurrentCount(CapturedOutput output) {
        double createdBefore = lifecycleCount("created");
        double updatedBefore = lifecycleCount("updated");
        double deletedBefore = lifecycleCount("soft_deleted");
        long first = create(FRAME_ID).getVersionId();
        long second = client.updateFrame(edit(FRAME_ID, first, "PENDING")).getVersionId();
        assertError(Status.Code.ABORTED, STALE, () -> client.updateFrame(edit(FRAME_ID, first, "BLOCKED")));
        assertError(Status.Code.ABORTED, STALE, () -> delete(FRAME_ID, first));
        assertError(Status.Code.ALREADY_EXISTS, RESERVED, () -> create(FRAME_ID));
        assertError(Status.Code.NOT_FOUND, MISSING, () -> get("MISSING"));
        assertError(Status.Code.INVALID_ARGUMENT, "One or more request values are invalid.",
            () -> client.listFrames(ListFramesRequest.newBuilder().setSize(0).build()));
        create("FRM-2");
        delete(FRAME_ID, second);
        delete(FRAME_ID, null);
        var correlationId = "69b8e848-c107-42dd-9f38-646f1497b3de";
        var headers = new Metadata();
        headers.put(Metadata.Key.of("x-correlation-id", Metadata.ASCII_STRING_MARSHALLER), correlationId);
        client.withInterceptors(MetadataUtils.newAttachHeadersInterceptor(headers))
            .listFrames(ListFramesRequest.newBuilder().setPage(9).setSize(2).build());

        transactions.executeWithoutResult(transaction -> {
            var attributes = FrameProtoMapper.toAttributes(FrameData.newBuilder().setStatus("LIVE").build());
            var created = service.create("ROLLED-BACK", attributes);
            var updated = service.edit("ROLLED-BACK", created.versionId(), attributes);
            service.delete("ROLLED-BACK", updated.versionId());
            transaction.setRollbackOnly();
        });

        assertThat(lifecycleCount("created")).isEqualTo(createdBefore + 2);
        assertThat(lifecycleCount("updated")).isEqualTo(updatedBefore + 1);
        assertThat(lifecycleCount("soft_deleted")).isEqualTo(deletedBefore + 1);

        var logs = output.getOut().lines().toList();
        assertThat(logs).anySatisfy(line -> assertThat(line).contains(
            "\"message\":\"frame.created\"", "\"frameId\":\"FRM-1\"", "\"versionId\":" + first
        ));
        assertThat(logs).anySatisfy(line -> assertThat(line).contains(
            "\"message\":\"frame.updated\"", "\"frameId\":\"FRM-1\"", "\"previousVersionId\":" + first,
            "\"newVersionId\":" + second
        ));
        assertThat(logs).anySatisfy(line -> assertThat(line).contains(
            "\"message\":\"frame.soft_deleted\"", "\"frameId\":\"FRM-1\"", "\"closedVersionId\":" + second
        ));
        assertThat(logs).anySatisfy(line -> assertThat(line).contains(
            "\"message\":\"frame.listed\"", "\"page\":9", "\"size\":2", "\"totalElements\":1",
            "\"correlationId\":\"" + correlationId + "\""
        ));
        assertThat(logs).anySatisfy(line -> assertThat(line).contains(
            "\"message\":\"frame.version_checked\"", "\"level\":\"DEBUG\"",
            "\"expectedVersionId\":" + first, "\"currentVersionId\":" + second
        ));
        assertThat(logs).anySatisfy(line -> assertThat(line).contains(
            "\"message\":\"frame.rpc_received\"", "\"level\":\"DEBUG\"", "\"rpc\":\"ListFrames\"", "\"page\":9"
        ));
        for (String resolution : List.of("upserted", "reused")) {
            assertThat(logs).anySatisfy(line -> assertThat(line).contains(
                "\"message\":\"frame.lookup_resolved\"", "\"level\":\"DEBUG\"", "\"lookup\":\"postcode\"",
                "\"resolution\":\"" + resolution + "\""
            ));
        }
        for (String status : List.of("ABORTED", "ALREADY_EXISTS", "NOT_FOUND", "INVALID_ARGUMENT")) {
            assertThat(logs).anySatisfy(line -> assertThat(line).contains(
                "\"message\":\"frame.client_error\"", "\"level\":\"DEBUG\"", "\"grpcStatus\":\"" + status + "\""
            ));
        }
        assertThat(logs).noneMatch(line -> line.contains("\"frameId\":\"ROLLED-BACK\"")
            && (line.contains("\"message\":\"frame.created\"") || line.contains("\"message\":\"frame.updated\"")
                || line.contains("\"message\":\"frame.soft_deleted\"")));
        assertThat(output.getOut()).doesNotContain("SW1A 1AA");
    }

    @Test
    void reportsUnknownFrameIds() throws Exception {
        var missing = assertError(Status.Code.NOT_FOUND, MISSING, () -> get("missing"));
        assertThat(info(missing).getReason()).isEqualTo("FRAME_NOT_FOUND");
        assertError(Status.Code.NOT_FOUND, MISSING, () -> history("missing"));
        assertError(Status.Code.NOT_FOUND, MISSING, () -> client.updateFrame(edit("missing", 1, "LIVE")));
        assertError(Status.Code.NOT_FOUND, MISSING, () -> delete("missing", null));
    }

    @Test
    void reportsInvalidFieldsAsStructuredGrpcErrors() throws Exception {
        var invalid = CreateFrameRequest.newBuilder().setFrameId(" ").setAttributes(FrameData.newBuilder()
            .setStatus("UNKNOWN")
            .setLongitude("181")
            .setLatitude("91")
            .setPixelWidth(0)
            .setNumberOfSlots(-1)
            .setDistanceToClosestSchool(-5)
            .setFormat(FrameFormat.newBuilder().setTechnology("UNKNOWN").setFormatCode("D6").setSizeGroupCode("006"))
        ).build();

        assertThat(invalidFields(() -> client.createFrame(invalid))).containsExactly(
            "attributes.distanceToClosestSchool", "attributes.format.technology", "attributes.latitude",
            "attributes.longitude", "attributes.numberOfSlots", "attributes.pixelWidth", "attributes.status", "frameId"
        );

        assertThat(invalidFields(() -> client.createFrame(CreateFrameRequest.newBuilder()
            .setFrameId(FRAME_ID)
            .setAttributes(FrameData.newBuilder().setStatus("LIVE").setLatitude("north"))
            .build()))).containsExactly("attributes.latitude");
        assertThat(invalidFields(() -> client.createFrame(CreateFrameRequest.newBuilder().setFrameId(FRAME_ID).build())))
            .containsExactly("attributes");
        assertThat(invalidFields(() -> client.updateFrame(edit(FRAME_ID, 0, "LIVE"))))
            .containsExactly("expectedVersionId");
        assertThat(invalidFields(() -> get(" "))).containsExactly("frameId");
        assertThat(invalidFields(() -> client.listFrames(ListFramesRequest.newBuilder().setPage(-1).setSize(51).build())))
            .containsExactly("page", "size");
        assertThat(invalidFields(() -> client.listFrames(ListFramesRequest.newBuilder().setSize(0).build())))
            .containsExactly("size");
        assertThat(invalidFields(() -> delete(FRAME_ID, 0L))).containsExactly("expectedVersionId");
    }

    @Test
    void editsImportedFramesWithANewSourceTimeAndRetainsVersionOwnedReferences() {
        jdbc.sql("INSERT INTO frame (frame_id) VALUES ('IMPORTED')").update();
        long importedVersion = jdbc.sql("""
            INSERT INTO frame_version (frame_id, valid_from, status, source_created_at, source_modified_at)
            VALUES ('IMPORTED', clock_timestamp(), 'LIVE', '2022-08-01 11:00:00', '2022-08-02 12:00:00')
            RETURNING version_id
            """).query(Long.class).single();
        jdbc.sql("""
            INSERT INTO frame_version_external_reference (version_id, reference_type, reference_value)
            VALUES (:version, 'PRICE_ENTITY', '123')
            """).param("version", importedVersion).update();
        jdbc.sql("""
            INSERT INTO frame_version_link (version_id, position, linked_frame_id)
            VALUES (:version, 1, 'FRM-3'), (:version, 2, 'FRM-2')
            """).param("version", importedVersion).update();

        var before = java.time.LocalDateTime.now(java.time.ZoneOffset.UTC).minusSeconds(1);
        Frame edited = client.updateFrame(edit("IMPORTED", importedVersion, "DRAFT"));
        assertThat(edited.getSourceCreatedAt()).isEqualTo("2022-08-01T11:00:00");
        assertThat(java.time.LocalDateTime.parse(edited.getSourceModifiedAt())).isAfter(before);
        assertThat(history("IMPORTED").getLast().getSourceModifiedAt()).isEqualTo("2022-08-02T12:00:00");
        assertThat(edited.getExternalReferencesMap()).containsEntry("PRICE_ENTITY", "123");
        assertThat(edited.getLinkedFrameIdsList()).containsExactly("FRM-3", "FRM-2");
    }

    @Test
    void closesThePriorVersionAfterItsStartWhenTheClockIsBehindTheStoredVersion() {
        jdbc.sql("INSERT INTO frame (frame_id) VALUES ('FUTURE')").update();
        long version = jdbc.sql("""
            INSERT INTO frame_version (frame_id, valid_from, status)
            VALUES ('FUTURE', '2099-01-01T00:00:00Z', 'LIVE')
            RETURNING version_id
            """).query(Long.class).single();

        var next = client.updateFrame(edit("FUTURE", version, "DRAFT"));
        assertThat(next.getValidFrom().getSeconds()).isEqualTo(4070908800L);
        assertThat(next.getValidFrom().getNanos()).isEqualTo(1000);
        assertThat(history("FUTURE").getLast().getValidTo()).isEqualTo(next.getValidFrom());
    }

    @Test
    void editsRacingWithTheSameTokenProduceOnlyOneReplacement() throws Exception {
        long first = create(FRAME_ID).getVersionId();
        var barrier = new CyclicBarrier(2);

        try (var executor = Executors.newFixedThreadPool(2)) {
            var firstEdit = executor.submit(() -> raceEdit(first, barrier, "BLOCKED"));
            var secondEdit = executor.submit(() -> raceEdit(first, barrier, "PENDING"));
            assertThat(List.of(firstEdit.get(10, TimeUnit.SECONDS), secondEdit.get(10, TimeUnit.SECONDS)))
                .containsExactlyInAnyOrder(Status.Code.OK, Status.Code.ABORTED);
        }

        assertThat(history(FRAME_ID)).extracting(Frame::getCurrent).containsExactly(true, false);
    }

    @Test
    void failedVersionInsertRollsBackTheClosure() {
        long first = create(FRAME_ID).getVersionId();
        var invalidAttributes = new FrameAttributes(
            null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null, null,
            null, null, null, false, null, null, null
        );

        assertThatThrownBy(() -> service.edit(FRAME_ID, first, invalidAttributes))
            .isInstanceOf(DataIntegrityViolationException.class);

        assertThat(history(FRAME_ID)).singleElement().satisfies(frame -> {
            assertThat(frame.getVersionId()).isEqualTo(first);
            assertThat(frame.getCurrent()).isTrue();
        });
    }

    @Test
    void flywayUpgradesADataBearingV1Schema() {
        Flyway.configure().dataSource(dataSource).schemas("upgrade_test").target("1").load().migrate();
        jdbc.sql("INSERT INTO upgrade_test.frame VALUES ('legacy')").update();
        jdbc.sql("""
            INSERT INTO upgrade_test.frame_version (frame_id, valid_from, status)
            VALUES ('legacy', clock_timestamp(), 'LIVE')
            """).update();

        Flyway.configure().dataSource(dataSource).schemas("upgrade_test").load().migrate();

        assertThat(jdbc.sql("""
            SELECT count(*) FROM upgrade_test.frame_version
            WHERE frame_id = 'legacy' AND change_source IS NULL AND closed_by_change_source IS NULL
            """).query(Integer.class).single()).isEqualTo(1);
    }

    private double lifecycleCount(String operation) {
        return meters.get("frame.lifecycle.changes").tag("operation", operation).counter().count();
    }

    private List<String> invalidFields(Executable call) throws InvalidProtocolBufferException {
        var failure = assertError(Status.Code.INVALID_ARGUMENT, "One or more request values are invalid.", call);
        return StatusProto.fromThrowable(failure).getDetails(0).unpack(BadRequest.class).getFieldViolationsList()
            .stream().map(violation -> violation.getField()).toList();
    }

    private static ErrorInfo info(StatusRuntimeException failure) throws InvalidProtocolBufferException {
        return StatusProto.fromThrowable(failure).getDetails(0).unpack(ErrorInfo.class);
    }

    private static StatusRuntimeException assertError(Status.Code expected, String message, Executable call) {
        var failure = assertThrows(StatusRuntimeException.class, call);
        assertThat(failure.getStatus().getCode()).isEqualTo(expected);
        assertThat(failure.getStatus().getDescription()).isEqualTo(message);
        return failure;
    }

    private Status.Code raceEdit(long first, CyclicBarrier barrier, String status) throws Exception {
        barrier.await(10, TimeUnit.SECONDS);
        try {
            client.updateFrame(edit(FRAME_ID, first, status));
            return Status.Code.OK;
        } catch (StatusRuntimeException exception) {
            return exception.getStatus().getCode();
        }
    }

    @Test
    void keepsImportLineageInFrameHistoryAfterTheJobDiagnosticsExpire() {
        var frame = create(FRAME_ID);
        assertThat(frame.hasImportJobId()).isFalse();

        UUID jobId = UUID.randomUUID();
        jdbc.sql("""
                INSERT INTO import_jobs (job_id, owner_id, import_mode, force_overwrite, status,
                    object_bucket, object_key, object_version_id, upload_expires_at, dispatch_until, finished_at)
                VALUES (:id, 'local-import-operator', 'DELTA', false, 'COMPLETED',
                    'test', :key, 'stable-version', now() - interval '8 days',
                    now() - interval '8 days', now() - interval '8 days')
                """).param("id", jobId).param("key", "uploads/" + jobId + "/inventory_frame.csv").update();
        jdbc.sql("UPDATE frame_version SET import_job_id = :job WHERE version_id = :version")
            .param("job", jobId).param("version", frame.getVersionId()).update();

        assertThat(history(FRAME_ID)).singleElement()
            .satisfies(version -> assertThat(version.getImportJobId()).isEqualTo(jobId.toString()));
    }

    private Frame create(String frameId) {
        return client.createFrame(CreateFrameRequest.newBuilder().setFrameId(frameId)
            .setAttributes(FrameData.newBuilder().setStatus("LIVE").setLatitude("51.501").setLongitude("-0.142")
                .setLocation(FrameLocation.newBuilder()
                    .setCountryCode("UK").setRegion("London").setTown("London").setPostcode("SW1A 1AA"))
                .setFormat(FrameFormat.newBuilder().setTechnology("DIGITAL").setFormatCode("D6").setSizeGroupCode("006")))
            .build());
    }

    private Frame get(String frameId) {
        return client.getFrame(GetFrameRequest.newBuilder().setFrameId(frameId).build());
    }

    private List<Frame> history(String frameId) {
        return client.getFrameHistory(GetFrameHistoryRequest.newBuilder().setFrameId(frameId).build()).getVersionsList();
    }

    private Empty delete(String frameId, Long expectedVersionId) {
        var request = DeleteFrameRequest.newBuilder().setFrameId(frameId);
        if (expectedVersionId != null) {
            request.setExpectedVersionId(expectedVersionId);
        }
        return client.deleteFrame(request.build());
    }

    private static UpdateFrameRequest edit(String frameId, long expectedVersionId, String status) {
        return UpdateFrameRequest.newBuilder().setFrameId(frameId).setExpectedVersionId(expectedVersionId)
            .setAttributes(FrameData.newBuilder().setStatus(status)).build();
    }
}

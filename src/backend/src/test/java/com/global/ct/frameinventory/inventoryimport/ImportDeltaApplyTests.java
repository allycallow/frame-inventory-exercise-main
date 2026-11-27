package com.global.ct.frameinventory.inventoryimport;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@Testcontainers
class ImportDeltaApplyTests {
    private static final Path FIXTURE = Path.of("../../data/inventory_frame.csv");

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18.6");

    @Autowired
    ImportDeltaApplyTests(ImportDeltaApply delta, ImportStaging staging, ImportJobRepository jobs,
                          InventoryCsvReader reader, ObjectMapper mapper, JdbcClient jdbc) {
        this.delta = delta;
        this.staging = staging;
        this.jobs = jobs;
        this.reader = reader;
        this.mapper = mapper;
        this.jdbc = jdbc;
    }

    private final ImportDeltaApply delta;
    private final ImportStaging staging;
    private final ImportJobRepository jobs;
    private final InventoryCsvReader reader;
    private final ObjectMapper mapper;
    private final JdbcClient jdbc;

    @BeforeEach
    void reset() {
        jdbc.sql("""
            TRUNCATE frame, region, frame_format, import_jobs, stg_inventory_import,
                stg_inventory_import_completion RESTART IDENTITY CASCADE
            """).update();
    }

    @Test
    void suppliedFileImportsAllRowsAndItsReplayAppendsNoVersions() throws IOException {
        List<InventoryCsvReader.Row> rows = fixture();
        assertThat(rows).hasSize(1_000).allMatch(row -> row.errorCode() == null);
        var first = apply(rows, false);
        assertThat(first.status()).isEqualTo("COMPLETED");
        assertThat(first.rowsApplied()).isEqualTo(1_000);
        assertThat(count("frame_version")).isEqualTo(1_000);
        assertThat(count("frame_version_link")).isEqualTo(8);
        assertThat(count("frame_version_external_reference")).isGreaterThan(1_000);

        var second = apply(rows, false);
        assertThat(second.status()).isEqualTo("COMPLETED");
        assertThat(second.rowsUnchanged()).isEqualTo(1_000);
        assertThat(second.rowsApplied()).isZero();
        assertThat(count("frame_version")).isEqualTo(1_000);
        assertThat(count("stg_inventory_import")).isZero();
    }

    @Test
    void measuresRecentDeltaJobAndRowOutcomes() throws IOException {
        var registry = new SimpleMeterRegistry();
        new ImportMetrics(registry, jobs);
        var completed = registry.get("inventory.import.jobs.finished.last.hour").tag("status", "COMPLETED").gauge();
        var applied = registry.get("inventory.import.rows.last.hour").tag("outcome", "applied").gauge();
        assertThat(completed.value()).isZero();
        assertThat(applied.value()).isZero();

        var rows = fixture();
        apply(rows.subList(0, 1), false);
        var invalid = new InventoryCsvReader.Row(3, null, null, "INVALID_FIELD", "invalid");
        apply(List.of(rows.get(0), rows.get(1), invalid), false);
        newJob(false);

        jdbc.sql("""
            INSERT INTO import_jobs (job_id, owner_id, import_mode, force_overwrite, status,
                object_bucket, object_key, object_version_id, upload_expires_at, dispatch_until,
                finished_at, rows_read, rows_applied, rows_rejected)
            SELECT id, 'test-operator', mode, false, status, 'test-bucket',
                'uploads/' || id || '/inventory_frame.csv', 'version', now(), now(),
                now() - age, applied + rejected, applied, rejected
            FROM (VALUES
                (gen_random_uuid(), 'DELTA', 'COMPLETED', interval '2 hours', 8, 0),
                (gen_random_uuid(), 'FULL_SNAPSHOT', 'COMPLETED', interval '1 minute', 4, 0),
                (gen_random_uuid(), 'DELTA', 'FAILED', interval '1 minute', 0, 5),
                (gen_random_uuid(), 'DELTA', 'EXPIRED', interval '1 minute', 0, 0)
            ) AS fixtures(id, mode, status, age, applied, rejected)
            """).update();

        assertThat(completed.value()).isEqualTo(1);
        for (String status : List.of("COMPLETED_WITH_ERRORS", "FAILED", "EXPIRED")) {
            assertThat(registry.get("inventory.import.jobs.finished.last.hour").tag("status", status).gauge().value())
                .isEqualTo(1);
        }
        assertThat(applied.value()).isEqualTo(2);
        assertThat(registry.get("inventory.import.rows.last.hour").tag("outcome", "unchanged").gauge().value())
            .isEqualTo(1);
        assertThat(registry.get("inventory.import.rows.last.hour").tag("outcome", "rejected").gauge().value())
            .isEqualTo(1);
    }

    @Test
    void rejectsDuplicateRowsStaleTimestampsAndCollisionsUnlessExplicitlyForced() throws IOException {
        var rows = fixture();
        var original = rows.getFirst();
        apply(List.of(original), false);
        var stale = changed(original, "2026-01-01T00:00:00", "Old details");
        var collision = changed(original, "2026-05-11T22:18:05", "Different details");
        String secondId = rows.get(1).frameId();
        var duplicate = new InventoryCsvReader.Row(3, secondId, null, "INVALID_FIELD", "invalid");
        var job = apply(List.of(collision, rows.get(1), duplicate), false);
        assertThat(job.status()).isEqualTo("COMPLETED_WITH_ERRORS");
        assertThat(job.rowsRejected()).isEqualTo(3);
        var errors = jobs.errors(job.jobId(), 0, 25);
        assertThat(errors).extracting(ImportJobRepository.RowError::code)
            .containsExactly("TIMESTAMP_COLLISION_CONFLICT", "DUPLICATE_FRAME_ID", "DUPLICATE_FRAME_ID");
        assertThat(errors.getFirst().detail()).containsPattern("[0-9a-f]{64}.*[0-9a-f]{64}");
        var staleJob = apply(List.of(stale), false);
        assertThat(jobs.errors(staleJob.jobId(), 0, 25)).extracting(ImportJobRepository.RowError::code)
            .containsExactly("STALE_RECORD");

        var forced = apply(List.of(stale), true);
        assertThat(forced.rowsApplied()).isEqualTo(1);
        assertThat(jdbc.sql("""
            SELECT change_source FROM frame_version WHERE import_job_id = :job AND is_current
            """).param("job", forced.jobId()).query(String.class).single()).isEqualTo("FORCED_OVERWRITE");
        assertThat(jdbc.sql("""
            SELECT count(*) FROM frame_version old JOIN frame_version live USING (frame_id)
            WHERE NOT old.is_current AND live.is_current AND old.valid_to = live.valid_from
            """).query(Integer.class).single()).isEqualTo(1);
        assertThat(apply(List.of(stale), true).rowsUnchanged()).isEqualTo(1);
    }

    @Test
    void preservesManualDeleteAndUsesTheLegacyManualStartAsTheBaseline() throws IOException {
        var original = fixture().getFirst();
        apply(List.of(original), false);
        jdbc.sql("""
            UPDATE frame_version SET change_source = 'MANUAL_EDIT', legacy_manual_source = true
            """).update();
        var legacy = apply(List.of(changed(original, "2026-05-11T22:18:06", "Old export")), false);
        assertThat(jobs.errors(legacy.jobId(), 0, 25)).extracting(ImportJobRepository.RowError::code)
            .containsExactly("STALE_RECORD");
        jdbc.sql("""
            UPDATE frame_version SET is_current = false, valid_to = valid_from + interval '1 second',
                closed_by_change_source = 'MANUAL_DELETE'
            """).update();
        var blocked = apply(List.of(original), false);
        assertThat(jobs.errors(blocked.jobId(), 0, 25)).extracting(ImportJobRepository.RowError::code)
            .containsExactly("MANUALLY_DELETED");
        var restored = apply(List.of(original), true);
        assertThat(restored.rowsApplied()).isEqualTo(1);
        assertThat(count("frame_version")).isEqualTo(2);
    }

    @Test
    void incompleteOrLostStagingCannotApplyAndNewGenerationFencesOldAttempts() throws IOException {
        var job = newJob(false);
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        var row = fixture().getFirst();
        assertThat(staging.claim(job, first, 1)).isPresent();
        staging.append(job, first, List.of(row));
        assertThat(delta.apply(job, first)).isFalse();
        staging.complete(job, first, 1);
        jdbc.sql("DELETE FROM stg_inventory_import").update();
        assertThat(delta.apply(job, first)).isFalse();
        assertThat(count("frame_version")).isZero();

        assertThat(staging.claim(job, second, 11)).isPresent();
        assertThat(staging.claim(job, first, 2)).isEmpty();
        assertThatThrownBy(() -> staging.append(job, first, List.of(row))).isInstanceOf(IllegalStateException.class);
        staging.append(job, second, List.of(row));
        staging.complete(job, second, 1);
        assertThat(delta.apply(job, second)).isTrue();
        assertThat(delta.apply(job, second)).isTrue();
        assertThat(count("frame_version")).isEqualTo(1);
    }

    @Test
    void failedVersionInsertRollsBackBothTheCloseAndTheJobOutcome() throws IOException {
        var original = fixture().getFirst();
        apply(List.of(original), false);
        UUID job = newJob(false);
        UUID generation = UUID.randomUUID();
        var payload = (ObjectNode) mapper.readTree(changed(original, "2026-05-12T00:00:00", "Later").payload());
        payload.putNull("status");
        assertThat(staging.claim(job, generation, 1)).isPresent();
        staging.append(job, generation, List.of(new InventoryCsvReader.Row(1, original.frameId(),
            payload.toString(), null, null)));
        staging.complete(job, generation, 1);

        assertThatThrownBy(() -> delta.apply(job, generation))
            .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        assertThat(jdbc.sql("SELECT is_current FROM frame_version").query(Boolean.class).single()).isTrue();
        assertThat(count("frame_version")).isEqualTo(1);
        assertThat(jobs.findOwned(job, "test-operator").orElseThrow().status()).isEqualTo("RUNNING");
    }

    @Test
    void parsesQuotedMultilineRecordsAndRejectsBrokenQuoting() throws IOException {
        var lines = Files.readAllLines(FIXTURE);
        String first = lines.get(1).replace("VICTORIA LINE PLATFORM 4 SOUTHBOUND", "\"first line\nsecond line\"");
        var data = lines.getFirst() + "\n" + first + "\n";
        var rows = new ArrayList<InventoryCsvReader.Row>();
        assertThat(reader.read(new ByteArrayInputStream(data.getBytes(StandardCharsets.UTF_8)), rows::add)).isOne();
        assertThat(mapper.readTree(rows.getFirst().payload()).get("address").asText()).isEqualTo("first line\nsecond line");
        var broken = lines.getFirst() + "\n\"unclosed";
        assertThatThrownBy(() -> reader.read(new ByteArrayInputStream(broken.getBytes(StandardCharsets.UTF_8)), rows::add))
            .isInstanceOf(InventoryCsvReader.FileProblem.class).hasMessage("INVALID_CSV");
    }

    private List<InventoryCsvReader.Row> fixture() throws IOException {
        var rows = new ArrayList<InventoryCsvReader.Row>();
        reader.read(Files.newInputStream(FIXTURE), rows::add);
        return rows;
    }

    private InventoryCsvReader.Row changed(InventoryCsvReader.Row original, String timestamp, String address)
        throws IOException {
        var payload = (ObjectNode) mapper.readTree(original.payload());
        payload.put("source_modified_at", timestamp).put("address", address);
        return new InventoryCsvReader.Row(original.number(), original.frameId(), payload.toString(), null, null);
    }

    private ImportJobRepository.Job apply(List<InventoryCsvReader.Row> rows, boolean force) {
        UUID job = newJob(force);
        UUID generation = UUID.randomUUID();
        assertThat(staging.claim(job, generation, 1)).isPresent();
        staging.append(job, generation, rows);
        staging.complete(job, generation, rows.size());
        assertThat(delta.apply(job, generation)).isTrue();
        return jobs.findOwned(job, "test-operator").orElseThrow();
    }

    private UUID newJob(boolean force) {
        UUID job = UUID.randomUUID();
        String key = "uploads/" + job + "/inventory_frame.csv";
        jobs.create(job, "test-operator", force, "test-bucket", key, Instant.now().plusSeconds(60),
            Instant.now().plusSeconds(120));
        assertThat(jobs.bindUpload(job, "test-bucket", key, "version", Instant.now())).isTrue();
        return job;
    }

    private int count(String table) {
        return jdbc.sql("SELECT count(*) FROM " + table).query(Integer.class).single();
    }
}

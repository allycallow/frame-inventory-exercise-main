package com.global.ct.frameinventory.inventoryimport;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.grpc.Status;
import io.temporal.api.workflowservice.v1.DescribeWorkflowExecutionResponse;
import io.temporal.api.workflowservice.v1.WorkflowServiceGrpc;
import io.temporal.client.WorkflowClient;
import io.temporal.client.WorkflowClientOptions;
import io.temporal.client.WorkflowOptions;
import io.temporal.client.WorkflowStub;
import io.temporal.serviceclient.WorkflowServiceStubs;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.ChangeMessageVisibilityRequest;
import software.amazon.awssdk.services.sqs.model.DeleteMessageRequest;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.MessageSystemAttributeName;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageResponse;

import static io.temporal.api.enums.v1.WorkflowIdConflictPolicy.WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING;
import static io.temporal.api.enums.v1.WorkflowIdReusePolicy.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class ImportDispatchTests {
    private static final String BUCKET = "test-bucket";
    private static final UUID ID = UUID.fromString("9aa2f678-f75a-444c-851b-f4b8831083c0");
    private static final String KEY = "uploads/" + ID + "/inventory_frame.csv";
    private static final String VERSION = "accepted-version";
    private final Instant uploadedAt = Instant.now();
    private final S3ImportNotifications parser = new S3ImportNotifications(new ObjectMapper());
    private final S3ImportNotifications.Upload upload =
        new S3ImportNotifications.Upload(ID, BUCKET, KEY, VERSION, uploadedAt);
    private final ImportJobRepository jobs = mock(ImportJobRepository.class);
    private final S3Client s3 = mock(S3Client.class);
    private final ImportTemporalDispatch workflow = mock(ImportTemporalDispatch.class);
    private final ImportDispatch dispatch = new ImportDispatch(parser, jobs, s3, workflow, BUCKET);

    @Test
    void decodesNativeRecordsAndIgnoresTestAndUnrelatedEvents() {
        assertThat(parser.parse("{\"Event\":\"s3:TestEvent\"}", BUCKET)).isEmpty();
        assertThat(parser.parse(message(record(BUCKET, KEY, VERSION), record("other-bucket", KEY, VERSION)), BUCKET))
            .containsExactly(upload);
        assertThatThrownBy(() -> parser.parse(message(record(BUCKET, KEY, "")), BUCKET))
            .isInstanceOf(S3ImportNotifications.InvalidNotification.class);
    }

    @Test
    void pinsTheVerifiedObjectBeforeStartingAndDoesNotReplaceItOnReplay() {
        when(jobs.findUpload(ID, BUCKET, KEY)).thenReturn(Optional.of(job("AWAITING_UPLOAD", null, 60)));
        when(s3.headObject(anyHead())).thenAnswer(invocation -> {
            var request = HeadObjectRequest.builder();
            invocation.<Consumer<HeadObjectRequest.Builder>>getArgument(0).accept(request);
            assertThat(request.build().versionId()).isEqualTo(VERSION);
            return HeadObjectResponse.builder().contentLength(10L).build();
        });
        when(jobs.bindUpload(ID, BUCKET, KEY, VERSION, uploadedAt)).thenReturn(true);

        dispatch.dispatch(message(record(BUCKET, KEY, VERSION)));
        var order = org.mockito.Mockito.inOrder(jobs, workflow);
        order.verify(jobs).bindUpload(ID, BUCKET, KEY, VERSION, uploadedAt);
        order.verify(workflow).start(upload);

        when(jobs.findUpload(ID, BUCKET, KEY)).thenReturn(Optional.of(job("PENDING", VERSION, 60)));
        dispatch.dispatch(message(record(BUCKET, KEY, "other-version")));
        verify(workflow, times(1)).start(any());
    }

    @Test
    void rejectsOversizedUploadsBeforeStartingATemporalWorkflow() {
        when(jobs.findUpload(ID, BUCKET, KEY)).thenReturn(Optional.of(job("AWAITING_UPLOAD", null, 60)));
        when(s3.headObject(anyHead())).thenReturn(HeadObjectResponse.builder().contentLength(10_485_761L).build());

        dispatch.dispatch(message(record(BUCKET, KEY, VERSION)));

        verify(jobs).rejectOversizedUpload(ID, BUCKET, KEY, uploadedAt);
        verifyNoInteractions(workflow);
    }

    @Test
    void usesStableWorkflowIdAndRunningAndClosedDuplicatePolicies() {
        var temporal = mock(WorkflowClient.class);
        var stub = mock(WorkflowStub.class);
        var options = ArgumentCaptor.forClass(WorkflowOptions.class);
        when(jobs.lockBoundUpload(ID, VERSION)).thenReturn(Optional.of(job("PENDING", VERSION, 60)));
        when(temporal.newUntypedWorkflowStub(eq("CsvImportWorkflow"), any(WorkflowOptions.class))).thenReturn(stub);

        new ImportTemporalDispatch(jobs, temporal, "inventory-import").start(upload);

        verify(temporal).newUntypedWorkflowStub(eq("CsvImportWorkflow"), options.capture());
        assertThat(options.getValue().getWorkflowId()).isEqualTo("csv-import-" + ID);
        assertThat(options.getValue().getWorkflowIdConflictPolicy()).isEqualTo(WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING);
        assertThat(options.getValue().getWorkflowIdReusePolicy()).isEqualTo(WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE);
        verify(stub).start(ID.toString());
        verify(jobs).confirmDispatch(ID, VERSION);
    }

    @Test
    void deadLetterPreservesAnAmbiguousStartThatTemporalActuallyAccepted() {
        var temporal = mockTemporalLookup();
        when(temporal.getWorkflowServiceStubs().blockingStub().describeWorkflowExecution(any()))
            .thenReturn(DescribeWorkflowExecutionResponse.getDefaultInstance());
        when(jobs.lockBoundUpload(ID, VERSION)).thenReturn(Optional.of(job("PENDING", VERSION, -60)));

        new ImportTemporalDispatch(jobs, temporal, "inventory-import").reconcileDeadLetter(upload);

        verify(jobs, never()).failDispatch(ID, VERSION);
        verify(jobs).confirmDispatch(ID, VERSION);
    }

    @Test
    void deadLetterFailsOnlyAStillPendingJobAfterTheGraceWindowAndConfirmedAbsence() {
        var temporal = mockTemporalLookup();
        when(temporal.getWorkflowServiceStubs().blockingStub().describeWorkflowExecution(any()))
            .thenThrow(Status.NOT_FOUND.asRuntimeException());
        when(jobs.lockBoundUpload(ID, VERSION)).thenReturn(Optional.of(job("PENDING", VERSION, 60)),
            Optional.of(job("PENDING", VERSION, -60)));
        var service = new ImportTemporalDispatch(jobs, temporal, "inventory-import");

        assertThatThrownBy(() -> service.reconcileDeadLetter(upload))
            .isInstanceOf(ImportTemporalDispatch.DispatchStillReconciling.class);
        verify(jobs, never()).failDispatch(ID, VERSION);
        service.reconcileDeadLetter(upload);
        verify(jobs).failDispatch(ID, VERSION);
    }

    @Test
    void terminalAndLateJobsDoNotRestart() {
        when(jobs.findUpload(ID, BUCKET, KEY)).thenReturn(Optional.of(job("FAILED", VERSION, -60)),
            Optional.of(job("AWAITING_UPLOAD", null, -60)));

        dispatch.dispatch(message(record(BUCKET, KEY, VERSION)));
        dispatch.dispatch(message(record(BUCKET, KEY, VERSION)));

        verifyNoInteractions(workflow, s3);
    }

    @Test
    void oneFailedRecordDoesNotPreventProcessingOtherRecordsButDefersAcknowledgment() {
        var sqs = mock(SqsClient.class);
        var other = new S3ImportNotifications.Upload(ID, BUCKET, KEY, "other", uploadedAt);
        String body = message(record(BUCKET, KEY, VERSION), record(BUCKET, KEY, other.version()));
        var incoming = Message.builder().body(body).receiptHandle("receipt").attributes(Map.of(
            MessageSystemAttributeName.APPROXIMATE_RECEIVE_COUNT, "2")).build();
        when(sqs.receiveMessage(anyReceive())).thenReturn(ReceiveMessageResponse.builder()
            .messages(List.of(incoming)).build());
        when(jobs.findUpload(ID, BUCKET, KEY)).thenReturn(Optional.of(job("PENDING", VERSION, 60)),
            Optional.of(job("PENDING", other.version(), 60)));
        doThrow(Status.UNAVAILABLE.asRuntimeException()).when(workflow).start(upload);

        var poller = new ImportQueuePoller(sqs, dispatch, "source", "dlq");
        poller.pollSource();

        verify(workflow).start(other);
        verify(sqs, never()).deleteMessage(org.mockito.ArgumentMatchers.<Consumer<DeleteMessageRequest.Builder>>any());
        verify(sqs).changeMessageVisibility(org.mockito.ArgumentMatchers.<Consumer<ChangeMessageVisibilityRequest.Builder>>argThat(action -> {
            var builder = ChangeMessageVisibilityRequest.builder();
            action.accept(builder);
            return builder.build().visibilityTimeout() == 10;
        }));
    }

    private static WorkflowClient mockTemporalLookup() {
        var temporal = mock(WorkflowClient.class);
        var service = mock(WorkflowServiceStubs.class);
        var stub = mock(WorkflowServiceGrpc.WorkflowServiceBlockingStub.class);
        when(temporal.getOptions()).thenReturn(WorkflowClientOptions.newBuilder().setNamespace("default").build());
        when(temporal.getWorkflowServiceStubs()).thenReturn(service);
        when(service.blockingStub()).thenReturn(stub);
        when(stub.withDeadlineAfter(anyLong(), any())).thenReturn(stub);
        return temporal;
    }

    private static Consumer<HeadObjectRequest.Builder> anyHead() {
        return any();
    }

    private static Consumer<ReceiveMessageRequest.Builder> anyReceive() {
        return any();
    }

    private static ImportJobRepository.Job job(String status, String version, int graceSeconds) {
        var now = OffsetDateTime.now(ZoneOffset.UTC);
        return new ImportJobRepository.Job(ID, "owner", "DELTA", false, status, BUCKET, KEY, version, now,
            now, now.plusSeconds(graceSeconds), null, 0, 0, 0, 0, 0, null, null);
    }

    private String record(String bucket, String key, String version) {
        return """
            {"eventSource":"aws:s3","eventName":"ObjectCreated:Put","eventTime":"%s","s3":{
              "bucket":{"name":"%s"},"object":{"key":"%s","versionId":"%s"}}}
            """.formatted(uploadedAt, bucket, key.replace("/", "%2F"), version);
    }

    private static String message(String... records) {
        return "{\"Records\":[" + String.join(",", records) + "]}";
    }
}

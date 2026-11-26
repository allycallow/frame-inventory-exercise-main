package com.global.ct.frameinventory.inventoryimport;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.temporal.api.common.v1.WorkflowExecution;
import io.temporal.api.enums.v1.WorkflowIdConflictPolicy;
import io.temporal.api.enums.v1.WorkflowIdReusePolicy;
import io.temporal.api.workflowservice.v1.DescribeWorkflowExecutionRequest;
import io.temporal.client.WorkflowClient;
import io.temporal.client.WorkflowExecutionAlreadyStarted;
import io.temporal.client.WorkflowOptions;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Profile("local-import")
@ConditionalOnProperty(name = "inventory.import.dispatch.enabled", havingValue = "true")
class ImportTemporalDispatch {
    private final ImportJobRepository jobs;
    private final WorkflowClient temporal;
    private final String taskQueue;

    ImportTemporalDispatch(ImportJobRepository jobs, WorkflowClient temporal,
                           @Value("${inventory.import.dispatch.task-queue:inventory-import}") String taskQueue) {
        this.jobs = jobs;
        this.temporal = temporal;
        this.taskQueue = taskQueue;
    }

    @Transactional
    public void start(S3ImportNotifications.Upload upload) {
        var job = jobs.lockBoundUpload(upload.jobId(), upload.version());
        if (job.isEmpty() || !job.get().status().equals("PENDING") || job.get().dispatchConfirmedAt() != null) {
            return;
        }
        var options = WorkflowOptions.newBuilder().setWorkflowId(workflowId(upload.jobId()))
            .setTaskQueue(taskQueue)
            .setWorkflowIdConflictPolicy(WorkflowIdConflictPolicy.WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING)
            .setWorkflowIdReusePolicy(WorkflowIdReusePolicy.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE)
            .setWorkflowExecutionTimeout(Duration.ofHours(1))
            .build();
        try {
            temporal.newUntypedWorkflowStub("CsvImportWorkflow", options).start(upload.jobId().toString());
        } catch (WorkflowExecutionAlreadyStarted duplicate) {
            // The stable ID already belongs to this job, even if the execution has closed.
        }
        jobs.confirmDispatch(upload.jobId(), upload.version());
    }

    @Transactional
    public void reconcileDeadLetter(S3ImportNotifications.Upload upload) {
        var job = jobs.lockBoundUpload(upload.jobId(), upload.version());
        if (job.isEmpty() || !job.get().status().equals("PENDING") || job.get().dispatchConfirmedAt() != null) {
            return;
        }
        var request = DescribeWorkflowExecutionRequest.newBuilder()
            .setNamespace(temporal.getOptions().getNamespace())
            .setExecution(WorkflowExecution.newBuilder().setWorkflowId(workflowId(upload.jobId())))
            .build();
        try {
            temporal.getWorkflowServiceStubs().blockingStub().withDeadlineAfter(5, TimeUnit.SECONDS)
                .describeWorkflowExecution(request);
            jobs.confirmDispatch(upload.jobId(), upload.version());
        } catch (StatusRuntimeException error) {
            if (error.getStatus().getCode() != Status.Code.NOT_FOUND) {
                throw error;
            }
            if (job.get().dispatchUntil().toInstant().isAfter(Instant.now())) {
                throw new DispatchStillReconciling();
            }
            jobs.failDispatch(upload.jobId(), upload.version());
        }
    }

    private static String workflowId(UUID jobId) {
        return "csv-import-" + jobId;
    }

    static final class DispatchStillReconciling extends RuntimeException {}
}

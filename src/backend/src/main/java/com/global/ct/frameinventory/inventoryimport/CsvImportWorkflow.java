package com.global.ct.frameinventory.inventoryimport;

import java.time.Duration;

import io.temporal.activity.ActivityInterface;
import io.temporal.activity.ActivityOptions;
import io.temporal.common.RetryOptions;
import io.temporal.failure.ActivityFailure;
import io.temporal.failure.ApplicationFailure;
import io.temporal.workflow.Workflow;
import io.temporal.workflow.WorkflowInterface;
import io.temporal.workflow.WorkflowMethod;

@WorkflowInterface
public interface CsvImportWorkflow {
    // This name matches the dispatch contract.
    @WorkflowMethod(name = "CsvImportWorkflow")
    void run(String jobId);

    @ActivityInterface
    interface Activities {
        String stage(String jobId, int pass);
        boolean apply(String jobId, String generation);
        void fail(String jobId, String code);
    }

    class Implementation implements CsvImportWorkflow {
        private final Activities stager = Workflow.newActivityStub(Activities.class, ActivityOptions.newBuilder()
            .setStartToCloseTimeout(Duration.ofMinutes(3)).setHeartbeatTimeout(Duration.ofSeconds(30))
            .setRetryOptions(RetryOptions.newBuilder().setMaximumAttempts(3).build()).build());
        private final Activities database = Workflow.newActivityStub(Activities.class, ActivityOptions.newBuilder()
            .setStartToCloseTimeout(Duration.ofMinutes(2))
            .setRetryOptions(RetryOptions.newBuilder().setMaximumAttempts(3).build()).build());

        @Override
        public void run(String jobId) {
            try {
                for (int pass = 0; pass < 3; pass++) {
                    String generation = stager.stage(jobId, pass);
                    if (generation.isEmpty() || database.apply(jobId, generation)) {
                        return;
                    }
                }
            } catch (ActivityFailure failure) {
                Throwable cause = failure.getCause();
                String code = cause instanceof ApplicationFailure application && application.isNonRetryable()
                    ? application.getType() : "IMPORT_PROCESSING_FAILED";
                database.fail(jobId, code);
                return;
            }
            database.fail(jobId, "STAGING_UNAVAILABLE");
        }
    }
}

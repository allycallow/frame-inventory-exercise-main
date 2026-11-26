package com.global.ct.frameinventory.inventoryimport;

import java.time.Instant;
import java.util.UUID;

import io.grpc.Status;
import io.temporal.client.WorkflowClient;
import io.temporal.client.WorkflowOptions;
import io.temporal.client.WorkflowStub;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@SpringBootTest(classes = ImportTemporalDispatchPersistenceTests.TestConfig.class, properties = {
    "inventory.import.dispatch.enabled=true",
    "spring.grpc.server.port=0"
})
@ActiveProfiles("local-import")
@Testcontainers
class ImportTemporalDispatchPersistenceTests {
    private static final String BUCKET = "test-bucket";
    private static final String VERSION = "accepted-version";

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18.6");

    private final ImportJobRepository jobs;
    private final ImportTemporalDispatch dispatch;
    private final WorkflowClient temporal;

    @Autowired
    ImportTemporalDispatchPersistenceTests(ImportJobRepository jobs, ImportTemporalDispatch dispatch,
                                          WorkflowClient temporal) {
        this.jobs = jobs;
        this.dispatch = dispatch;
        this.temporal = temporal;
    }

    @Test
    void persistedConfirmationPreventsAnotherTemporalCallOnReplay() {
        var upload = boundUpload();
        var stub = mock(WorkflowStub.class);
        when(temporal.newUntypedWorkflowStub(eq("CsvImportWorkflow"), any(WorkflowOptions.class))).thenReturn(stub);

        dispatch.start(upload);

        var confirmed = jobs.findUpload(upload.jobId(), BUCKET, upload.key()).orElseThrow();
        assertThat(confirmed.status()).isEqualTo("PENDING");
        assertThat(confirmed.objectVersionId()).isEqualTo(VERSION);
        assertThat(confirmed.dispatchConfirmedAt()).isNotNull();
        verify(stub).start(upload.jobId().toString());
        clearInvocations(temporal, stub);

        dispatch.start(upload);

        verifyNoInteractions(temporal, stub);
        assertThat(jobs.findUpload(upload.jobId(), BUCKET, upload.key()).orElseThrow().dispatchConfirmedAt())
            .isEqualTo(confirmed.dispatchConfirmedAt());
    }

    @Test
    void failedStartLeavesBoundUploadUnconfirmedAndRetryable() {
        var upload = boundUpload();
        var stub = mock(WorkflowStub.class);
        when(temporal.newUntypedWorkflowStub(eq("CsvImportWorkflow"), any(WorkflowOptions.class))).thenReturn(stub);
        when(stub.start(upload.jobId().toString()))
            .thenThrow(Status.UNAVAILABLE.asRuntimeException()).thenReturn(null);

        assertThatThrownBy(() -> dispatch.start(upload)).isInstanceOf(io.grpc.StatusRuntimeException.class);

        var failed = jobs.findUpload(upload.jobId(), BUCKET, upload.key()).orElseThrow();
        assertThat(failed.status()).isEqualTo("PENDING");
        assertThat(failed.objectVersionId()).isEqualTo(VERSION);
        assertThat(failed.dispatchConfirmedAt()).isNull();

        dispatch.start(upload);

        verify(stub, times(2)).start(upload.jobId().toString());
        var confirmed = jobs.findUpload(upload.jobId(), BUCKET, upload.key()).orElseThrow();
        assertThat(confirmed.status()).isEqualTo("PENDING");
        assertThat(confirmed.objectVersionId()).isEqualTo(VERSION);
        assertThat(confirmed.dispatchConfirmedAt()).isNotNull();
    }

    private S3ImportNotifications.Upload boundUpload() {
        var id = UUID.randomUUID();
        var key = "uploads/" + id + "/inventory_frame.csv";
        var now = Instant.now();
        jobs.create(id, "owner", false, BUCKET, key, now.plusSeconds(60), now.plusSeconds(120));
        assertThat(jobs.bindUpload(id, BUCKET, key, VERSION, now)).isTrue();
        return new S3ImportNotifications.Upload(id, BUCKET, key, VERSION, now);
    }

    @Configuration(proxyBeanMethods = false)
    @EnableAutoConfiguration
    @Import({ImportJobRepository.class, ImportTemporalDispatch.class})
    static class TestConfig {
        @Bean
        WorkflowClient temporal() {
            return mock(WorkflowClient.class);
        }
    }
}

package com.global.ct.frameinventory.inventoryimport;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import com.global.ct.frameinventory.grpc.v1.CreateImportJobRequest;
import com.global.ct.frameinventory.grpc.v1.GetImportJobRequest;
import com.global.ct.frameinventory.grpc.v1.ImportJobStatus;
import com.global.ct.frameinventory.grpc.v1.ImportMode;
import com.global.ct.frameinventory.grpc.v1.InventoryImportGrpc;
import com.global.ct.frameinventory.grpc.v1.ListImportRowErrorsRequest;

import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Metadata;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.grpc.test.LocalGrpcPort;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(properties = {
    "spring.grpc.server.port=0",
    "inventory.import.bucket=test-import-bucket",
    "inventory.import.local-token=" + ImportGrpcTests.TOKEN
})
@ActiveProfiles("local-import")
@Testcontainers
class ImportGrpcTests {
    static final String TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18.6");

    private final JdbcClient jdbc;
    private final ImportJobRepository jobs;
    private final ManagedChannel channel;
    private final InventoryImportGrpc.InventoryImportBlockingStub client;

    @Autowired
    ImportGrpcTests(@LocalGrpcPort int port, JdbcClient jdbc, ImportJobRepository jobs) {
        this.jdbc = jdbc;
        this.jobs = jobs;
        channel = ManagedChannelBuilder.forAddress("127.0.0.1", port).usePlaintext().build();
        var metadata = new Metadata();
        metadata.put(Metadata.Key.of("authorization", Metadata.ASCII_STRING_MARSHALLER), "Bearer " + TOKEN);
        client = InventoryImportGrpc.newBlockingStub(channel)
            .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(metadata))
            .withDeadlineAfter(10, TimeUnit.SECONDS);
    }

    @AfterEach
    void closeChannel() {
        channel.shutdownNow();
    }

    @Test
    void authenticatesAndSignsAJobBoundCreateOnlyUpload() {
        assertStatus(Status.Code.UNAUTHENTICATED, () -> InventoryImportGrpc.newBlockingStub(channel)
            .withDeadlineAfter(10, TimeUnit.SECONDS).createImportJob(CreateImportJobRequest.getDefaultInstance()));

        var result = client.createImportJob(CreateImportJobRequest.newBuilder().setForceOverwrite(true).build());
        var job = result.getJob();
        assertThat(job.getMode()).isEqualTo(ImportMode.DELTA);
        assertThat(job.getStatus()).isEqualTo(ImportJobStatus.AWAITING_UPLOAD);
        assertThat(job.getForceOverwrite()).isTrue();
        assertThat(result.getUploadHeadersMap()).containsEntry("if-none-match", "*")
            .containsEntry("content-type", "text/csv").doesNotContainKey("host");

        var url = URI.create(result.getUploadUrl());
        assertThat(url.getPath()).isEqualTo("/test-import-bucket/uploads/" + job.getJobId() + "/inventory_frame.csv");
        assertThat(url.getQuery()).contains("X-Amz-Expires=900", "X-Amz-SignedHeaders=content-type;host;if-none-match");
        assertThat(client.getImportJob(query(job.getJobId()))).isEqualTo(job);
    }

    @Test
    void validatesModeIdsAndPaginationAndHidesJobsOfOtherOperators() {
        assertStatus(Status.Code.FAILED_PRECONDITION, () -> client.createImportJob(
            CreateImportJobRequest.newBuilder().setMode(ImportMode.FULL_SNAPSHOT).build()));
        assertStatus(Status.Code.INVALID_ARGUMENT, () -> client.getImportJob(query("1-1-1-1-1")));
        assertStatus(Status.Code.INVALID_ARGUMENT, () -> client.listImportRowErrors(
            ListImportRowErrorsRequest.newBuilder().setSize(51).build()));

        UUID otherJob = UUID.randomUUID();
        jobs.create(otherJob, "other-operator", false, "test-import-bucket", key(otherJob),
            Instant.now().plusSeconds(60), Instant.now().plusSeconds(120));
        assertStatus(Status.Code.NOT_FOUND, () -> client.getImportJob(query(otherJob.toString())));
        assertStatus(Status.Code.NOT_FOUND, () -> client.listImportRowErrors(
            ListImportRowErrorsRequest.newBuilder().setJobId(otherJob.toString()).build()));
    }

    @Test
    void bindsOneVersionAndExpiresOnlyUnboundJobsAfterDispatchGrace() {
        var job = client.createImportJob(CreateImportJobRequest.getDefaultInstance()).getJob();
        var id = UUID.fromString(job.getJobId());
        Instant uploadedAt = Instant.now();

        assertThat(jobs.bindUpload(id, "other-bucket", key(id), "wrong-bucket", uploadedAt)).isFalse();
        assertThat(jobs.bindUpload(id, "test-import-bucket", key(id), "null", uploadedAt)).isFalse();
        assertThat(jobs.bindUpload(id, "test-import-bucket", key(id), "late",
            uploadedAt.plus(Duration.ofHours(1)))).isFalse();
        assertThat(jobs.bindUpload(id, "test-import-bucket", key(id), "first", uploadedAt)).isTrue();
        assertThat(jobs.bindUpload(id, "test-import-bucket", key(id), "first", uploadedAt)).isTrue();
        assertThat(jobs.bindUpload(id, "test-import-bucket", key(id), "second", uploadedAt)).isFalse();
        assertThat(client.getImportJob(query(job.getJobId())).getStatus()).isEqualTo(ImportJobStatus.PENDING);

        var abandoned = client.createImportJob(CreateImportJobRequest.getDefaultInstance()).getJob();
        jdbc.sql("""
                UPDATE import_jobs SET upload_expires_at = now() - interval '1 minute',
                    dispatch_until = now() + interval '1 minute' WHERE job_id = :id
                """).param("id", UUID.fromString(abandoned.getJobId())).update();
        assertThat(client.getImportJob(query(abandoned.getJobId())).getStatus())
            .isEqualTo(ImportJobStatus.AWAITING_UPLOAD);
        jdbc.sql("UPDATE import_jobs SET dispatch_until = now() WHERE job_id = :id")
            .param("id", UUID.fromString(abandoned.getJobId())).update();
        var expired = client.getImportJob(query(abandoned.getJobId()));
        assertThat(expired.getStatus()).isEqualTo(ImportJobStatus.EXPIRED);
        assertThat(expired.getFailureCode()).isEqualTo("UPLOAD_EXPIRED");
        assertThat(expired.hasFinishedAt()).isTrue();
    }

    @Test
    void pagesErrorsAndPurgesDiagnosticsWithoutDeletingTheSummary() {
        var job = client.createImportJob(CreateImportJobRequest.getDefaultInstance()).getJob();
        var id = UUID.fromString(job.getJobId());
        jdbc.sql("""
                INSERT INTO import_row_errors (job_id, row_number, code, detail)
                VALUES (:id, 2, 'B', 'second'), (:id, 1, 'A', 'first')
                """).param("id", id).update();
        var request = ListImportRowErrorsRequest.newBuilder().setJobId(job.getJobId()).setSize(1);
        var first = client.listImportRowErrors(request.build());
        assertThat(first.getHasNext()).isTrue();
        assertThat(first.getItems(0).getRowNumber()).isEqualTo(1);
        var second = client.listImportRowErrors(request.setPage(1).build());
        assertThat(second.getHasNext()).isFalse();
        assertThat(second.getItems(0).getRowNumber()).isEqualTo(2);

        jdbc.sql("""
                UPDATE import_jobs SET status = 'FAILED', finished_at = now() - interval '8 days',
                    failure_code = 'TEST_FAILURE', rows_read = 2, rows_rejected = 2 WHERE job_id = :id
                """).param("id", id).update();
        jobs.deleteExpiredDiagnostics();
        assertThat(client.listImportRowErrors(request.setPage(0).build()).getItemsList()).isEmpty();
        assertThat(jdbc.sql("SELECT count(*) FROM import_row_errors WHERE job_id = :id")
            .param("id", id).query(Integer.class).single()).isZero();
        assertThat(client.getImportJob(query(job.getJobId())).getRowsRejected()).isEqualTo(2);
    }

    private static GetImportJobRequest query(String id) {
        return GetImportJobRequest.newBuilder().setJobId(id).build();
    }

    private static String key(UUID id) {
        return "uploads/" + id + "/inventory_frame.csv";
    }

    private static void assertStatus(Status.Code code, Runnable request) {
        assertThatThrownBy(request::run).isInstanceOfSatisfying(StatusRuntimeException.class,
            error -> assertThat(error.getStatus().getCode()).isEqualTo(code));
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class SigningConfiguration {
        @Bean
        @Primary
        ImportUploadSigner testSigner() {
            return new ImportUploadSigner(S3Presigner.builder().region(Region.US_EAST_1)
                .endpointOverride(URI.create("http://localhost:4566"))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test")))
                .build());
        }
    }
}

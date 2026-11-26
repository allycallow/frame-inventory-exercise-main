package com.global.ct.frameinventory.inventoryimport;

import java.time.OffsetDateTime;
import java.util.UUID;

import com.global.ct.frameinventory.grpc.v1.CreateImportJobRequest;
import com.global.ct.frameinventory.grpc.v1.CreateImportJobResponse;
import com.global.ct.frameinventory.grpc.v1.GetImportJobRequest;
import com.global.ct.frameinventory.grpc.v1.ImportJob;
import com.global.ct.frameinventory.grpc.v1.ImportJobStatus;
import com.global.ct.frameinventory.grpc.v1.ImportMode;
import com.global.ct.frameinventory.grpc.v1.ImportRowError;
import com.global.ct.frameinventory.grpc.v1.InventoryImportGrpc;
import com.global.ct.frameinventory.grpc.v1.ListImportRowErrorsRequest;
import com.global.ct.frameinventory.grpc.v1.ListImportRowErrorsResponse;
import com.google.protobuf.Timestamp;
import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import org.springframework.context.annotation.Profile;
import org.springframework.grpc.server.service.GrpcService;

@GrpcService(interceptors = LocalImportIdentity.class, blendWithGlobalInterceptors = true)
@Profile("local-import")
class ImportGrpcService extends InventoryImportGrpc.InventoryImportImplBase {
    private final ImportJobService jobs;

    ImportGrpcService(ImportJobService jobs) {
        this.jobs = jobs;
    }

    @Override
    public void createImportJob(CreateImportJobRequest request, StreamObserver<CreateImportJobResponse> response) {
        String owner = LocalImportIdentity.requireOperator();
        switch (request.getMode()) {
            case FULL_SNAPSHOT -> throw Status.FAILED_PRECONDITION
                .withDescription("Full snapshot imports are disabled").asRuntimeException();
            case UNRECOGNIZED -> throw Status.INVALID_ARGUMENT
                .withDescription("Unsupported import mode").asRuntimeException();
            default -> { }
        }
        var upload = jobs.create(owner, request.getForceOverwrite());
        reply(response, CreateImportJobResponse.newBuilder().setJob(toProto(upload.job()))
            .setUploadUrl(upload.url()).putAllUploadHeaders(upload.headers()).build());
    }

    @Override
    public void getImportJob(GetImportJobRequest request, StreamObserver<ImportJob> response) {
        reply(response, toProto(jobs.get(jobId(request.getJobId()), LocalImportIdentity.requireOperator())));
    }

    @Override
    public void listImportRowErrors(ListImportRowErrorsRequest request,
                                    StreamObserver<ListImportRowErrorsResponse> response) {
        int page = request.getPage();
        int size = request.hasSize() ? request.getSize() : 25;
        if (page < 0 || size < 1 || size > 50) {
            throw Status.INVALID_ARGUMENT.withDescription("Page must be nonnegative and size must be 1–50")
                .asRuntimeException();
        }
        var errors = jobs.errors(jobId(request.getJobId()), LocalImportIdentity.requireOperator(), page, size);
        var result = ListImportRowErrorsResponse.newBuilder().setPage(page).setSize(size)
            .setHasNext(errors.hasNext());
        for (var row : errors.items()) {
            var error = ImportRowError.newBuilder().setRowNumber(row.rowNumber())
                .setCode(row.code()).setDetail(row.detail());
            if (row.frameId() != null) {
                error.setFrameId(row.frameId());
            }
            result.addItems(error);
        }
        reply(response, result.build());
    }

    private static UUID jobId(String value) {
        try {
            UUID id = UUID.fromString(value);
            if (id.toString().equalsIgnoreCase(value)) {
                return id;
            }
        } catch (IllegalArgumentException invalid) {
            // UUID.fromString also accepts abbreviated groups, which are rejected above.
        }
        throw Status.INVALID_ARGUMENT.withDescription("Job ID must be a UUID").asRuntimeException();
    }

    private static ImportJob toProto(ImportJobRepository.Job job) {
        var result = ImportJob.newBuilder().setJobId(job.jobId().toString())
            .setMode(ImportMode.valueOf(job.importMode())).setStatus(ImportJobStatus.valueOf(job.status()))
            .setForceOverwrite(job.forceOverwrite()).setCreatedAt(timestamp(job.createdAt()))
            .setUploadExpiresAt(timestamp(job.uploadExpiresAt())).setRowsRead(job.rowsRead())
            .setRowsApplied(job.rowsApplied()).setRowsUnchanged(job.rowsUnchanged())
            .setRowsRejected(job.rowsRejected()).setFramesRetired(job.framesRetired());
        if (job.finishedAt() != null) {
            result.setFinishedAt(timestamp(job.finishedAt()));
        }
        if (job.failureCode() != null) {
            result.setFailureCode(job.failureCode());
        }
        return result.build();
    }

    private static Timestamp timestamp(OffsetDateTime value) {
        return Timestamp.newBuilder().setSeconds(value.toEpochSecond()).setNanos(value.getNano()).build();
    }

    private static <T> void reply(StreamObserver<T> response, T result) {
        response.onNext(result);
        response.onCompleted();
    }
}

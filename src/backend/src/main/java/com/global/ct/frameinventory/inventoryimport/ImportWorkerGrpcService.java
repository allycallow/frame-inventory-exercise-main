package com.global.ct.frameinventory.inventoryimport;

import java.util.UUID;
import java.util.regex.Pattern;

import com.global.ct.frameinventory.grpc.v1.ApplyImportRequest;
import com.global.ct.frameinventory.grpc.v1.ApplyImportResponse;
import com.global.ct.frameinventory.grpc.v1.FailImportRequest;
import com.global.ct.frameinventory.grpc.v1.ImportWorkerGrpc;
import com.global.ct.frameinventory.grpc.v1.StageImportRequest;
import com.global.ct.frameinventory.grpc.v1.StageImportUpdate;
import com.google.protobuf.Empty;
import io.grpc.Context;
import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.grpc.server.service.GrpcService;

@GrpcService(interceptors = LocalImportIdentity.class, blendWithGlobalInterceptors = true)
@Profile("local-import")
@ConditionalOnProperty(name = "inventory.import.dispatch.enabled", havingValue = "true")
class ImportWorkerGrpcService extends ImportWorkerGrpc.ImportWorkerImplBase {
    private static final Pattern FAILURE_CODE = Pattern.compile("[A-Z][A-Z0-9_]{0,63}");

    private final ImportProcessing processing;

    ImportWorkerGrpcService(ImportProcessing processing) {
        this.processing = processing;
    }

    @Override
    public void stage(StageImportRequest request, StreamObserver<StageImportUpdate> response) {
        int pass = request.getPassNumber();
        int attempt = request.getAttempt();
        if (pass < 0 || pass > 2 || attempt < 1 || attempt > 3) {
            throw Status.INVALID_ARGUMENT.withDescription("Invalid staging pass or attempt").asRuntimeException();
        }
        UUID job = ImportGrpcService.jobId(request.getJobId());
        try {
            String generation = processing.stage(job, pass * 10 + attempt, rows -> {
                if (Context.current().isCancelled()) {
                    throw Status.CANCELLED.asRuntimeException();
                }
                response.onNext(StageImportUpdate.newBuilder().setRowsRead(rows).build());
            });
            response.onNext(StageImportUpdate.newBuilder().setGeneration(generation).build());
            response.onCompleted();
        } catch (InventoryCsvReader.FileProblem invalid) {
            response.onError(Status.INVALID_ARGUMENT.withDescription(invalid.getMessage()).asRuntimeException());
        }
    }

    @Override
    public void apply(ApplyImportRequest request, StreamObserver<ApplyImportResponse> response) {
        boolean finished = processing.apply(ImportGrpcService.jobId(request.getJobId()),
            ImportGrpcService.jobId(request.getGeneration()));
        response.onNext(ApplyImportResponse.newBuilder().setFinished(finished).build());
        response.onCompleted();
    }

    @Override
    public void fail(FailImportRequest request, StreamObserver<Empty> response) {
        if (!FAILURE_CODE.matcher(request.getCode()).matches()) {
            throw Status.INVALID_ARGUMENT.withDescription("Invalid import failure code").asRuntimeException();
        }
        processing.fail(ImportGrpcService.jobId(request.getJobId()), request.getCode());
        response.onNext(Empty.getDefaultInstance());
        response.onCompleted();
    }
}

package com.global.ct.frameinventory.inventoryimport;

import io.grpc.Status;
import io.grpc.StatusException;
import org.springframework.grpc.server.exception.GrpcExceptionHandler;
import org.springframework.stereotype.Component;

@Component
class ImportGrpcExceptionHandler implements GrpcExceptionHandler {
    @Override
    public StatusException handleException(Throwable exception) {
        if (!(exception instanceof ImportJobProblem problem)) {
            return null;
        }
        return switch (problem.code()) {
            case NOT_FOUND -> Status.NOT_FOUND.withDescription("Import job not found").asException();
            case NOT_CONFIGURED -> Status.FAILED_PRECONDITION.withDescription("Import bucket is not configured")
                .asException();
        };
    }
}

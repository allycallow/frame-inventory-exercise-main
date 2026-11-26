package com.global.ct.frameinventory.frame;

import java.util.Comparator;

import com.google.protobuf.Any;
import com.google.rpc.BadRequest;
import com.google.rpc.ErrorInfo;
import io.grpc.Status;
import io.grpc.StatusException;
import io.grpc.protobuf.StatusProto;
import jakarta.validation.ConstraintViolationException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.grpc.server.exception.GrpcExceptionHandler;
import org.springframework.stereotype.Component;

@Component
class FrameGrpcExceptionHandler implements GrpcExceptionHandler {
    private static final Logger LOGGER = LoggerFactory.getLogger(FrameGrpcExceptionHandler.class);

    @Override
    public StatusException handleException(Throwable exception) {
        if (exception instanceof FrameProblem problem) {
            return frameProblem(problem);
        }
        if (exception instanceof ConstraintViolationException invalid) {
            var errors = BadRequest.newBuilder();
            invalid.getConstraintViolations().stream()
                .map(violation -> fieldError(violation.getPropertyPath().toString(), violation.getMessage()))
                .sorted(Comparator.comparing((BadRequest.FieldViolation violation) -> violation.getField())
                    .thenComparing(BadRequest.FieldViolation::getDescription))
                .forEach(errors::addFieldViolations);
            return invalidRequest(errors.build());
        }
        if (exception instanceof InvalidField invalid) {
            return invalidRequest(BadRequest.newBuilder()
                .addFieldViolations(fieldError(invalid.field, invalid.getMessage()))
                .build());
        }
        return null;
    }

    private static StatusException frameProblem(FrameProblem problem) {
        Status.Code code = switch (problem.code()) {
            case FRAME_NOT_FOUND -> Status.Code.NOT_FOUND;
            case FRAME_ID_RESERVED -> Status.Code.ALREADY_EXISTS;
            case STALE_FRAME_VERSION -> Status.Code.ABORTED;
        };
        var log = LOGGER.atDebug()
            .addKeyValue("grpcStatus", code.name())
            .addKeyValue("reason", problem.code().name());
        var error = ErrorInfo.newBuilder()
            .setDomain("frameinventory.v1")
            .setReason(problem.code().name());
        if (problem.currentVersionId() != null) {
            error.putMetadata("currentVersionId", problem.currentVersionId().toString());
            log.addKeyValue("currentVersionId", problem.currentVersionId());
        }
        log.log("frame.client_error");
        return status(code, problem.getMessage(), Any.pack(error.build()));
    }

    private static StatusException invalidRequest(BadRequest errors) {
        LOGGER.atDebug()
            .addKeyValue("grpcStatus", Status.Code.INVALID_ARGUMENT.name())
            .addKeyValue("reason", "INVALID_REQUEST")
            .addKeyValue("fieldErrorCount", errors.getFieldViolationsCount())
            .log("frame.client_error");
        return status(Status.Code.INVALID_ARGUMENT, "One or more request values are invalid.", Any.pack(errors));
    }

    private static StatusException status(Status.Code code, String message, Any details) {
        return StatusProto.toStatusException(com.google.rpc.Status.newBuilder()
            .setCode(code.value())
            .setMessage(message)
            .addDetails(details)
            .build());
    }

    private static BadRequest.FieldViolation fieldError(String field, String message) {
        return BadRequest.FieldViolation.newBuilder().setField(field).setDescription(message).build();
    }

    static final class InvalidField extends RuntimeException {
        private final String field;

        InvalidField(String field, String message) {
            super(message);
            this.field = field;
        }
    }
}

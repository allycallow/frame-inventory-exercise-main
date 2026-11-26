package com.global.ct.frameinventory.common.grpc;

import java.util.UUID;
import java.util.function.Supplier;
import java.util.regex.Pattern;

import io.grpc.ForwardingServerCall;
import io.grpc.ForwardingServerCallListener;
import io.grpc.Metadata;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import io.grpc.Status;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.grpc.server.GlobalServerInterceptor;
import org.springframework.stereotype.Component;

@Component
@GlobalServerInterceptor
@Order(Ordered.HIGHEST_PRECEDENCE)
public class CorrelationIdInterceptor implements ServerInterceptor {
    private static final Logger LOGGER = LoggerFactory.getLogger(CorrelationIdInterceptor.class);
    private static final Metadata.Key<String> HEADER =
            Metadata.Key.of("x-correlation-id", Metadata.ASCII_STRING_MARSHALLER);
    private static final Pattern UUID_PATTERN =
Pattern.compile("[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}");
    private static final String LOG_FIELD = "correlationId";

    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call, Metadata headers, ServerCallHandler<ReqT, RespT> next) {
        String suppliedId = headers.get(HEADER);
        String correlationId = suppliedId != null && UUID_PATTERN.matcher(suppliedId).matches()
                ? suppliedId : UUID.randomUUID().toString();
        var loggingCall = new ForwardingServerCall.SimpleForwardingServerCall<ReqT, RespT>(call) {
            @Override
            public void close(Status status, Metadata trailers) {
                switch (status.getCode()) {
                    case UNKNOWN, INTERNAL, DATA_LOSS -> withCorrelationId(correlationId, () -> {
                        LOGGER.atError()
                            .addKeyValue("rpc", call.getMethodDescriptor().getFullMethodName())
                            .addKeyValue("grpcStatus", status.getCode().name())
                            .setCause(status.getCause())
                            .log("grpc.server_error");
                        return null;
                    });
                    default -> { }
                }
                super.close(status, trailers);
            }
        };
        var listener = withCorrelationId(correlationId, () -> next.startCall(loggingCall, headers));

        return new ForwardingServerCallListener.SimpleForwardingServerCallListener<>(listener) {
            @Override
            public void onHalfClose() {
                withCorrelationId(correlationId, () -> {
                    super.onHalfClose();
                    return null;
                });
            }
        };
    }

    private static <T> T withCorrelationId(String correlationId, Supplier<T> action) {
        String previous = MDC.get(LOG_FIELD);
        MDC.put(LOG_FIELD, correlationId);
        try {
            return action.get();
        } finally {
            if (previous == null) {
                MDC.remove(LOG_FIELD);
            } else {
                MDC.put(LOG_FIELD, previous);
            }
        }
    }
}

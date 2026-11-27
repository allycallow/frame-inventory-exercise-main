package com.global.ct.frameinventory.inventoryimport;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.regex.Pattern;

import io.grpc.Context;
import io.grpc.Contexts;
import io.grpc.Grpc;
import io.grpc.Metadata;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import io.grpc.Status;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/** Service-scoped authentication for the local import exercise. */
@Component
public final class LocalImportIdentity implements ServerInterceptor {
    private static final Metadata.Key<String> AUTHORIZATION =
            Metadata.Key.of("authorization", Metadata.ASCII_STRING_MARSHALLER);
    private static final Context.Key<String> OPERATOR = Context.key("import-operator");
    private static final Pattern TOKEN = Pattern.compile("[a-f0-9]{64}");

    private final boolean enabled;
    private final byte[] expectedAuthorization;

    public LocalImportIdentity(
            Environment environment,
            @Value("${inventory.import.local-token:}") String token) {
        enabled = environment.acceptsProfiles(Profiles.of("local-import"));
        if (enabled && !TOKEN.matcher(token).matches()) {
            throw new IllegalArgumentException(
                    "INVENTORY_IMPORT_LOCAL_TOKEN must be 64 lowercase hexadecimal characters. "
                            + "Generate one with `openssl rand -hex 32`.");
        }
        expectedAuthorization = ("Bearer " + token).getBytes(StandardCharsets.US_ASCII);
    }

    public static String requireOperator() {
        String operator = OPERATOR.get();
        if (operator == null) {
            throw Status.UNAUTHENTICATED.asRuntimeException();
        }
        return operator;
    }

    public static void requireJobOwner(String owner) {
        if (!requireOperator().equals(owner)) {
            throw Status.PERMISSION_DENIED.asRuntimeException();
        }
    }

    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call, Metadata headers, ServerCallHandler<ReqT, RespT> next) {
        if (!enabled) {
            call.close(Status.UNAVAILABLE.withDescription("Local imports are disabled"), new Metadata());
            return new ServerCall.Listener<>() {};
        }
        var peer = call.getAttributes().get(Grpc.TRANSPORT_ATTR_REMOTE_ADDR);
        String authorization = headers.get(AUTHORIZATION);
        if (!(peer instanceof InetSocketAddress socket) || socket.getAddress() == null
                || !socket.getAddress().isLoopbackAddress() || authorization == null
                || !MessageDigest.isEqual(expectedAuthorization, authorization.getBytes(StandardCharsets.US_ASCII))) {
            call.close(Status.UNAUTHENTICATED, new Metadata());
            return new ServerCall.Listener<>() {};
        }
        return Contexts.interceptCall(Context.current().withValue(OPERATOR, "local-import-operator"),
                call, headers, next);
    }
}

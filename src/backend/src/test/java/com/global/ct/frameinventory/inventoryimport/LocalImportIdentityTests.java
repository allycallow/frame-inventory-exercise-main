package com.global.ct.frameinventory.inventoryimport;

import java.net.InetSocketAddress;

import io.grpc.Attributes;
import io.grpc.Grpc;
import io.grpc.Metadata;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class LocalImportIdentityTests {
    private static final String TOKEN = "a".repeat(64);
    private static final Metadata.Key<String> AUTHORIZATION =
            Metadata.Key.of("authorization", Metadata.ASCII_STRING_MARSHALLER);

    private final ServerCall<String, String> call = mock();
    private final ServerCallHandler<String, String> handler = mock();

    @Test
    void staysDisabledOutsideLocalProfile() {
        new LocalImportIdentity(new MockEnvironment(), TOKEN).interceptCall(call, bearer(TOKEN), handler);

        assertRejected(Status.Code.UNAVAILABLE);
    }

    @Test
    void rejectsNonLoopbackPeerEvenWithValidCredential() {
        peer("192.0.2.1");
        localIdentity().interceptCall(call, bearer(TOKEN), handler);

        assertRejected(Status.Code.UNAUTHENTICATED);
    }

    @Test
    void rejectsIncorrectCredentialOnLoopback() {
        peer("127.0.0.1");
        localIdentity().interceptCall(call, bearer("b".repeat(64)), handler);

        assertRejected(Status.Code.UNAUTHENTICATED);
    }

    @Test
    void setsFixedOperatorAndChecksJobOwnership() {
        peer("127.0.0.1");
        Metadata headers = bearer(TOKEN);
        when(handler.startCall(call, headers)).thenAnswer(invocation -> {
            assertThat(LocalImportIdentity.requireOperator()).isEqualTo("local-import-operator");
            LocalImportIdentity.requireJobOwner("local-import-operator");
            assertThatThrownBy(() -> LocalImportIdentity.requireJobOwner("another-operator"))
                    .isInstanceOfSatisfying(StatusRuntimeException.class,
                            error -> assertThat(error.getStatus().getCode()).isEqualTo(Status.Code.PERMISSION_DENIED));
            return new ServerCall.Listener<String>() {};
        });

        localIdentity().interceptCall(call, headers, handler);

        verify(handler).startCall(call, headers);
    }

    private void peer(String host) {
        when(call.getAttributes()).thenReturn(Attributes.newBuilder()
                .set(Grpc.TRANSPORT_ATTR_REMOTE_ADDR, new InetSocketAddress(host, 12345))
                .build());
    }

    private void assertRejected(Status.Code code) {
        verify(call).close(argThat(status -> status.getCode() == code), any(Metadata.class));
        verifyNoInteractions(handler);
    }

    private static LocalImportIdentity localIdentity() {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("local-import");
        return new LocalImportIdentity(environment, TOKEN);
    }

    private static Metadata bearer(String token) {
        var headers = new Metadata();
        headers.put(AUTHORIZATION, "Bearer " + token);
        return headers;
    }
}

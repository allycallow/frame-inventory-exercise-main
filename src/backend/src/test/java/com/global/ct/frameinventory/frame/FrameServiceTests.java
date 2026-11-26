package com.global.ct.frameinventory.frame;

import java.time.OffsetDateTime;
import java.util.Optional;

import com.global.ct.frameinventory.common.InventoryWriteLock;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class FrameServiceTests {
    private static final String FRAME_ID = "FRM-1";
    private static final long CURRENT = 42L;
    private static final long NEXT = 43L;

    @Mock FrameRepository repository;
    @Mock InventoryWriteLock inventoryLock;
    @Mock FrameAttributes attributes;
    @Mock FrameVersion version;
    private FrameService service;

    @BeforeEach
    void setUp() {
        service = new FrameService(repository, new SimpleMeterRegistry(), inventoryLock);
    }

    @Test
    void reservesTheIdBeforeAppendingTheFirstVersion() {
        when(repository.reserveId(FRAME_ID)).thenReturn(true);
        when(repository.append(FRAME_ID, attributes, null, null, "MANUAL_CREATE")).thenReturn(NEXT);
        when(repository.findVersion(NEXT)).thenReturn(version);

        assertThat(service.create(FRAME_ID, attributes)).isSameAs(version);

        var sequence = inOrder(repository);
        sequence.verify(repository).reserveId(FRAME_ID);
        sequence.verify(repository).append(FRAME_ID, attributes, null, null, "MANUAL_CREATE");
    }

    @Test
    void rejectsAnIdThatHasAlreadyBeenReserved() {
        assertThatExceptionOfType(FrameProblem.class)
            .isThrownBy(() -> service.create(FRAME_ID, attributes))
            .satisfies(problem -> assertThat(problem.code()).isEqualTo(FrameProblem.Code.FRAME_ID_RESERVED));

        verify(repository).reserveId(FRAME_ID);
        verifyNoMoreInteractions(repository);
    }

    @Test
    void closesAndReplacesTheVersionAtTheSameInstantAfterCheckingTheToken() {
        var transition = OffsetDateTime.parse("2026-11-26T10:00:00Z");
        givenCurrentVersion();
        when(repository.close(CURRENT, null)).thenReturn(transition);
        when(repository.append(FRAME_ID, attributes, CURRENT, transition, "MANUAL_EDIT")).thenReturn(NEXT);
        when(repository.findVersion(NEXT)).thenReturn(version);

        assertThat(service.edit(FRAME_ID, CURRENT, attributes)).isSameAs(version);

        var sequence = inOrder(repository);
        sequence.verify(repository).lockFrame(FRAME_ID);
        sequence.verify(repository).currentVersionId(FRAME_ID);
        sequence.verify(repository).close(CURRENT, null);
        sequence.verify(repository).append(FRAME_ID, attributes, CURRENT, transition, "MANUAL_EDIT");
        sequence.verify(repository).copyVersionChildren(CURRENT, NEXT);
    }

    @Test
    void rejectsStaleEditsWithoutChangingTheStoredVersion() {
        givenCurrentVersion();

        assertThatExceptionOfType(FrameProblem.class)
            .isThrownBy(() -> service.edit(FRAME_ID, CURRENT - 1, attributes))
            .satisfies(problem -> {
                assertThat(problem.code()).isEqualTo(FrameProblem.Code.STALE_FRAME_VERSION);
                assertThat(problem.currentVersionId()).isEqualTo(CURRENT);
            });

        verify(repository).lockFrame(FRAME_ID);
        verify(repository).currentVersionId(FRAME_ID);
        verifyNoMoreInteractions(repository);
    }

    @Test
    void deleteClosesTheCurrentVersionWithoutAppendingAnother() {
        givenCurrentVersion();

        service.delete(FRAME_ID, CURRENT);

        var sequence = inOrder(repository);
        sequence.verify(repository).lockFrame(FRAME_ID);
        sequence.verify(repository).currentVersionId(FRAME_ID);
        sequence.verify(repository).close(CURRENT, "MANUAL_DELETE");
        sequence.verifyNoMoreInteractions();
    }

    @Test
    void rejectsAStaleDeleteWithoutClosingTheCurrentVersion() {
        givenCurrentVersion();

        assertThatExceptionOfType(FrameProblem.class)
            .isThrownBy(() -> service.delete(FRAME_ID, CURRENT - 1))
            .satisfies(problem -> assertThat(problem.currentVersionId()).isEqualTo(CURRENT));

        verify(repository).lockFrame(FRAME_ID);
        verify(repository).currentVersionId(FRAME_ID);
        verifyNoMoreInteractions(repository);
    }

    @Test
    void repeatedUnconditionalDeleteIsANoOp() {
        when(repository.lockFrame(FRAME_ID)).thenReturn(true);

        service.delete(FRAME_ID, null);

        verify(repository).lockFrame(FRAME_ID);
        verify(repository).currentVersionId(FRAME_ID);
        verifyNoMoreInteractions(repository);
    }

    private void givenCurrentVersion() {
        when(repository.lockFrame(FRAME_ID)).thenReturn(true);
        when(repository.currentVersionId(FRAME_ID)).thenReturn(Optional.of(CURRENT));
    }
}

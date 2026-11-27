package com.global.ct.frameinventory.inventoryimport;

import java.util.Optional;
import java.util.UUID;
import java.util.function.IntConsumer;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.s3.S3Client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class ImportProcessingTests {
    private final ImportStaging staging = mock(ImportStaging.class);
    private final ImportDeltaApply delta = mock(ImportDeltaApply.class);
    private final S3Client s3 = mock(S3Client.class);
    private final SimpleMeterRegistry metrics = new SimpleMeterRegistry();
    private final ImportProcessing processing =
        new ImportProcessing(staging, delta, mock(InventoryCsvReader.class), s3, metrics);

    @Test
    void skipsStagingWhenTheAttemptCannotClaimTheJob() {
        UUID job = UUID.randomUUID();
        IntConsumer progress = mock(IntConsumer.class);
        when(staging.claim(eq(job), any(UUID.class), eq(12))).thenReturn(Optional.empty());

        assertThat(processing.stage(job, 12, progress)).isEmpty();
        verify(staging).claim(eq(job), any(UUID.class), eq(12));
        verifyNoInteractions(s3, progress);
    }

    @Test
    void keepsRecordingApplyAttemptsWhenAnotherStagingPassIsNeeded() {
        UUID job = UUID.randomUUID();
        UUID generation = UUID.randomUUID();

        assertThat(processing.apply(job, generation)).isFalse();
        verify(delta).apply(job, generation);
        assertThat(metrics.get("inventory.import.apply").timer().count()).isEqualTo(1);
    }
}

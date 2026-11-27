package com.global.ct.frameinventory.inventoryimport;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.UUID;
import java.util.function.IntConsumer;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.s3.S3Client;

@Service
@Profile("local-import")
@ConditionalOnProperty(name = "inventory.import.dispatch.enabled", havingValue = "true")
class ImportProcessing {
    private static final long MAX_BYTES = 10L * 1024 * 1024;
    private static final int BATCH_SIZE = 200;

    private final ImportStaging staging;
    private final ImportDeltaApply delta;
    private final InventoryCsvReader reader;
    private final S3Client s3;
    private final Timer applyDuration;

    ImportProcessing(ImportStaging staging, ImportDeltaApply delta, InventoryCsvReader reader, S3Client s3,
                     MeterRegistry registry) {
        this.staging = staging;
        this.delta = delta;
        this.reader = reader;
        this.s3 = s3;
        applyDuration = Timer.builder("inventory.import.apply")
            .description("Time spent in each import apply activity attempt")
            .publishPercentileHistogram()
            .register(registry);
    }

    String stage(UUID job, int sequence, IntConsumer progress) {
        UUID generation = UUID.randomUUID();
        var claim = staging.claim(job, generation, sequence);
        if (claim.isEmpty()) {
            return "";
        }
        var object = claim.get();
        progress.accept(0);
        try (var stream = s3.getObject(request -> request.bucket(object.objectBucket())
                .key(object.objectKey()).versionId(object.objectVersionId()))) {
            if (stream.response().contentLength() > MAX_BYTES) {
                stream.abort();
                throw new InventoryCsvReader.FileProblem("UPLOAD_TOO_LARGE");
            }
            var batch = new ArrayList<InventoryCsvReader.Row>(BATCH_SIZE);
            int count = reader.read(stream, row -> {
                batch.add(row);
                if (batch.size() == BATCH_SIZE) {
                    staging.append(job, generation, batch);
                    batch.clear();
                    progress.accept(row.number());
                }
            });
            if (!batch.isEmpty()) {
                staging.append(job, generation, batch);
            }
            staging.complete(job, generation, count);
            progress.accept(count);
            return generation.toString();
        } catch (IOException readFailure) {
            throw new UncheckedIOException(readFailure);
        }
    }

    boolean apply(UUID job, UUID generation) {
        return applyDuration.record(() -> delta.apply(job, generation));
    }

    void fail(UUID job, String code) {
        delta.fail(job, code);
    }
}

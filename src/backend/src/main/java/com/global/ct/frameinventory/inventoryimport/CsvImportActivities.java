package com.global.ct.frameinventory.inventoryimport;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.UUID;

import io.micrometer.core.instrument.Timer;
import io.temporal.activity.Activity;
import io.temporal.failure.ApplicationFailure;
import software.amazon.awssdk.services.s3.S3Client;

public class CsvImportActivities implements CsvImportWorkflow.Activities {
    private static final long MAX_BYTES = 10L * 1024 * 1024;
    private static final int BATCH_SIZE = 200;

    private final ImportStaging staging;
    private final ImportDeltaApply delta;
    private final InventoryCsvReader reader;
    private final S3Client s3;
    private final Timer applyDuration;

    CsvImportActivities(ImportStaging staging, ImportDeltaApply delta, InventoryCsvReader reader, S3Client s3,
                        Timer applyDuration) {
        this.staging = staging;
        this.delta = delta;
        this.reader = reader;
        this.s3 = s3;
        this.applyDuration = applyDuration;
    }

    @Override
    public String stage(String jobId, int pass) {
        var context = Activity.getExecutionContext();
        UUID job = UUID.fromString(jobId);
        UUID generation = UUID.randomUUID();
        var claim = staging.claim(job, generation, pass * 10 + context.getInfo().getAttempt());
        if (claim.isEmpty()) {
            return "";
        }
        var object = claim.get();
        context.heartbeat(0);
        try (var stream = s3.getObject(request -> request.bucket(object.objectBucket())
                .key(object.objectKey()).versionId(object.objectVersionId()))) {
            if (stream.response().contentLength() > MAX_BYTES) {
                stream.abort();
                throw ApplicationFailure.newNonRetryableFailure("Upload exceeds 10 MiB", "UPLOAD_TOO_LARGE");
            }
            var batch = new ArrayList<InventoryCsvReader.Row>(BATCH_SIZE);
            int count = reader.read(stream, row -> {
                batch.add(row);
                if (batch.size() == BATCH_SIZE) {
                    staging.append(job, generation, batch);
                    batch.clear();
                    context.heartbeat(row.number());
                }
            });
            if (!batch.isEmpty()) {
                staging.append(job, generation, batch);
            }
            staging.complete(job, generation, count);
            context.heartbeat(count);
            return generation.toString();
        } catch (InventoryCsvReader.FileProblem invalid) {
            throw ApplicationFailure.newNonRetryableFailure("CSV validation failed", invalid.getMessage());
        } catch (IOException readFailure) {
            throw new UncheckedIOException(readFailure);
        }
    }

    @Override
    public boolean apply(String jobId, String generation) {
        return applyDuration.record(() -> delta.apply(UUID.fromString(jobId), UUID.fromString(generation)));
    }

    @Override
    public void fail(String jobId, String code) {
        delta.fail(UUID.fromString(jobId), code);
    }
}

package com.global.ct.frameinventory.inventoryimport;

import java.time.Instant;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.s3.S3Client;

@Service
@Profile("local-import")
@ConditionalOnProperty(name = "inventory.import.dispatch.enabled", havingValue = "true")
class ImportDispatch {
    private static final long MAX_UPLOAD_BYTES = 10L * 1024 * 1024;
    private final S3ImportNotifications notifications;
    private final ImportJobRepository jobs;
    private final S3Client s3;
    private final ImportTemporalDispatch temporal;
    private final String bucket;

    ImportDispatch(S3ImportNotifications notifications, ImportJobRepository jobs, S3Client s3,
                   ImportTemporalDispatch temporal, @Value("${inventory.import.bucket}") String bucket) {
        this.notifications = notifications;
        this.jobs = jobs;
        this.s3 = s3;
        this.temporal = temporal;
        this.bucket = bucket;
    }

    void dispatch(String message) {
        forEachUpload(notifications.parse(message, bucket), this::dispatchUpload);
    }

    void reconcileDeadLetter(String message) {
        forEachUpload(notifications.parse(message, bucket), upload -> {
            var job = jobs.findUpload(upload.jobId(), upload.bucket(), upload.key());
            if (job.isEmpty()) {
                return;
            }
            if (job.get().status().equals("AWAITING_UPLOAD")) {
                // The bind never committed. No workflow could have been started for this upload.
                jobs.failUnboundDispatch(upload.jobId(), upload.bucket(), upload.key(), upload.uploadedAt());
            }
            temporal.reconcileDeadLetter(upload);
        });
    }

    private void dispatchUpload(S3ImportNotifications.Upload upload) {
        var job = jobs.findUpload(upload.jobId(), upload.bucket(), upload.key());
        if (job.isEmpty()) {
            return;
        }
        var existing = job.get();
        if (existing.status().equals("AWAITING_UPLOAD")) {
            if (!existing.dispatchUntil().toInstant().isAfter(Instant.now())) {
                return;
            }
            var head = s3.headObject(request -> request.bucket(upload.bucket())
                .key(upload.key()).versionId(upload.version()));
            if (head.contentLength() > MAX_UPLOAD_BYTES) {
                jobs.rejectOversizedUpload(upload.jobId(), upload.bucket(), upload.key(), upload.uploadedAt());
                return;
            }
            if (!jobs.bindUpload(upload.jobId(), upload.bucket(), upload.key(), upload.version(), upload.uploadedAt())) {
                return;
            }
        } else if (!existing.status().equals("PENDING") || !upload.version().equals(existing.objectVersionId())) {
            return;
        }
        temporal.start(upload);
    }

    private static void forEachUpload(List<S3ImportNotifications.Upload> uploads,
                                      java.util.function.Consumer<S3ImportNotifications.Upload> handler) {
        RuntimeException firstFailure = null;
        for (var upload : uploads) {
            try {
                handler.accept(upload);
            } catch (RuntimeException failure) {
                if (firstFailure == null) {
                    firstFailure = failure;
                }
            }
        }
        if (firstFailure != null) {
            throw firstFailure;
        }
    }
}

package com.global.ct.frameinventory.inventoryimport;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
class ImportJobRepository {
    private final JdbcClient jdbc;

    ImportJobRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    Job create(UUID id, String owner, boolean force, String bucket, String key, Instant expiresAt,
               Instant dispatchUntil) {
        return jdbc.sql("""
                INSERT INTO import_jobs (job_id, owner_id, import_mode, force_overwrite, status,
                                         object_bucket, object_key, upload_expires_at, dispatch_until)
                VALUES (:id, :owner, 'DELTA', :force, 'AWAITING_UPLOAD', :bucket, :key, :expires, :dispatch)
                RETURNING *
                """)
            .param("id", id).param("owner", owner).param("force", force)
            .param("bucket", bucket).param("key", key)
            .param("expires", expiresAt.atOffset(ZoneOffset.UTC))
            .param("dispatch", dispatchUntil.atOffset(ZoneOffset.UTC))
            .query(Job.class).single();
    }

    Optional<Job> findOwned(UUID id, String owner) {
        return jdbc.sql("SELECT * FROM import_jobs WHERE job_id = :id AND owner_id = :owner")
            .param("id", id).param("owner", owner).query(Job.class).optional();
    }

    void expireAwaitingUploads() {
        jdbc.sql("""
                UPDATE import_jobs
                SET status = 'EXPIRED', finished_at = clock_timestamp(), failure_code = 'UPLOAD_EXPIRED'
                WHERE status = 'AWAITING_UPLOAD' AND dispatch_until <= clock_timestamp()
                """).update();
    }

    void expireOwnedUpload(UUID id, String owner) {
        jdbc.sql("""
                UPDATE import_jobs
                SET status = 'EXPIRED', finished_at = clock_timestamp(), failure_code = 'UPLOAD_EXPIRED'
                WHERE job_id = :id AND owner_id = :owner AND status = 'AWAITING_UPLOAD'
                  AND dispatch_until <= clock_timestamp()
                """).param("id", id).param("owner", owner).update();
    }

    // Dispatch can retry the same object without replacing its identity or regressing the job status.
    boolean bindUpload(UUID id, String bucket, String key, String version, Instant uploadedAt) {
        if (version.isBlank() || version.equals("null")) {
            return false;
        }
        int updated = jdbc.sql("""
                UPDATE import_jobs
                SET status = 'PENDING', object_version_id = :version
                WHERE job_id = :id AND object_bucket = :bucket AND object_key = :key
                  AND status = 'AWAITING_UPLOAD' AND dispatch_until > clock_timestamp()
                  AND :uploadedAt >= created_at - interval '1 second' AND :uploadedAt <= upload_expires_at
                """).param("id", id).param("bucket", bucket).param("key", key)
            .param("version", version).param("uploadedAt", uploadedAt.atOffset(ZoneOffset.UTC)).update();
        return updated == 1 || jdbc.sql("""
                SELECT EXISTS (
                    SELECT 1 FROM import_jobs WHERE job_id = :id AND object_bucket = :bucket
                      AND object_key = :key AND object_version_id = :version
                )
                """).param("id", id).param("bucket", bucket).param("key", key)
            .param("version", version).query(Boolean.class).single();
    }

    List<RowError> errors(UUID id, long offset, int limit) {
        return jdbc.sql("""
                SELECT e.row_number, e.code, e.frame_id, e.detail
                FROM import_row_errors e JOIN import_jobs j USING (job_id)
                WHERE e.job_id = :id AND (j.finished_at IS NULL OR j.finished_at > now() - interval '7 days')
                ORDER BY e.row_number, e.code
                OFFSET :offset LIMIT :limit
                """).param("id", id).param("offset", offset).param("limit", limit).query(RowError.class).list();
    }

    void deleteExpiredDiagnostics() {
        jdbc.sql("""
                DELETE FROM import_row_errors e USING import_jobs j
                WHERE e.job_id = j.job_id AND j.finished_at <= now() - interval '7 days'
                """).update();
    }

    record Job(UUID jobId, String ownerId, String importMode, boolean forceOverwrite, String status,
               String objectBucket, String objectKey, String objectVersionId, OffsetDateTime createdAt,
               OffsetDateTime uploadExpiresAt, OffsetDateTime dispatchUntil, OffsetDateTime finishedAt,
               int rowsRead, int rowsApplied, int rowsUnchanged, int rowsRejected, int framesRetired,
               String failureCode) {}

    record RowError(int rowNumber, String code, String frameId, String detail) {}
}

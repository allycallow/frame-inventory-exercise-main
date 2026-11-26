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
                  AND :uploadedAt >= created_at - interval '1 second' AND :uploadedAt <= dispatch_until
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

    Optional<Job> findUpload(UUID id, String bucket, String key) {
        return jdbc.sql("SELECT * FROM import_jobs WHERE job_id = :id AND object_bucket = :bucket AND object_key = :key")
            .param("id", id).param("bucket", bucket).param("key", key).query(Job.class).optional();
    }

    Optional<Job> lockBoundUpload(UUID id, String version) {
        return jdbc.sql("SELECT * FROM import_jobs WHERE job_id = :id AND object_version_id = :version FOR UPDATE")
            .param("id", id).param("version", version).query(Job.class).optional();
    }

    void confirmDispatch(UUID id, String version) {
        jdbc.sql("""
                UPDATE import_jobs SET dispatch_confirmed_at = clock_timestamp()
                WHERE job_id = :id AND status = 'PENDING' AND object_version_id = :version
                  AND dispatch_confirmed_at IS NULL
                """).param("id", id).param("version", version).update();
    }

    void failDispatch(UUID id, String version) {
        jdbc.sql("""
                UPDATE import_jobs
                SET status = 'FAILED', finished_at = clock_timestamp(), failure_code = 'DISPATCH_FAILED'
                WHERE job_id = :id AND status = 'PENDING' AND object_version_id = :version
                  AND dispatch_confirmed_at IS NULL
                """).param("id", id).param("version", version).update();
    }

    void rejectOversizedUpload(UUID id, String bucket, String key, Instant uploadedAt) {
        failAwaitingUpload(id, bucket, key, uploadedAt, "UPLOAD_TOO_LARGE");
    }

    void failUnboundDispatch(UUID id, String bucket, String key, Instant uploadedAt) {
        failAwaitingUpload(id, bucket, key, uploadedAt, "DISPATCH_FAILED");
    }

    private void failAwaitingUpload(UUID id, String bucket, String key, Instant uploadedAt, String reason) {
        jdbc.sql("""
                UPDATE import_jobs
                SET status = 'FAILED', finished_at = clock_timestamp(), failure_code = :reason
                WHERE job_id = :id AND object_bucket = :bucket AND object_key = :key
                  AND status = 'AWAITING_UPLOAD'
                  AND :uploadedAt >= created_at - interval '1 second' AND :uploadedAt <= dispatch_until
                """).param("id", id).param("bucket", bucket).param("key", key)
            .param("reason", reason).param("uploadedAt", uploadedAt.atOffset(ZoneOffset.UTC)).update();
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

    double oldestActiveSeconds(String status) {
        return jdbc.sql("""
                SELECT COALESCE(EXTRACT(EPOCH FROM now() - min(COALESCE(dispatch_confirmed_at, created_at))), 0)
                FROM import_jobs
                WHERE status = :status AND status IN ('PENDING', 'RUNNING')
                """).param("status", status).query(Double.class).single();
    }

    long recentDispatchFailures() {
        return jdbc.sql("""
                SELECT count(*) FROM import_jobs
                WHERE status = 'FAILED' AND failure_code = 'DISPATCH_FAILED'
                  AND finished_at >= now() - interval '1 hour'
                """).query(Long.class).single();
    }

    record Job(UUID jobId, String ownerId, String importMode, boolean forceOverwrite, String status,
               String objectBucket, String objectKey, String objectVersionId, OffsetDateTime createdAt,
               OffsetDateTime uploadExpiresAt, OffsetDateTime dispatchUntil, OffsetDateTime finishedAt,
               int rowsRead, int rowsApplied, int rowsUnchanged, int rowsRejected, int framesRetired,
               String failureCode, OffsetDateTime dispatchConfirmedAt) {}

    record RowError(int rowNumber, String code, String frameId, String detail) {}
}

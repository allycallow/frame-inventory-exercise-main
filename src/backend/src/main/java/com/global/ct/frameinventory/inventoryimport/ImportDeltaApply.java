package com.global.ct.frameinventory.inventoryimport;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

import com.global.ct.frameinventory.common.InventoryWriteLock;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class ImportDeltaApply {
    private final JdbcClient jdbc;
    private final JdbcTemplate statements;
    private final ImportStaging staging;
    private final InventoryWriteLock inventoryLock;
    private final String candidates = sql("delta-candidates.sql");
    private final String versions = sql("delta-insert-versions.sql");
    private final String[] dimensions = sql("delta-dimensions.sql").split(";");

    ImportDeltaApply(JdbcClient jdbc, JdbcTemplate statements, ImportStaging staging, InventoryWriteLock inventoryLock) {
        this.jdbc = jdbc;
        this.statements = statements;
        this.staging = staging;
        this.inventoryLock = inventoryLock;
    }

    @Transactional
    public boolean apply(UUID job, UUID generation) {
        var claim = jdbc.sql("""
                SELECT status, staging_generation, force_overwrite
                FROM import_jobs WHERE job_id = :job FOR UPDATE
                """).param("job", job).query(Claim.class).optional();
        if (claim.isEmpty() || !claim.get().status().equals("RUNNING")) {
            return true; // Already committed, or fenced out by a terminal result.
        }
        var current = claim.get();
        if (!generation.equals(current.stagingGeneration()) || !complete(job, generation)) {
            return false;
        }
        inventoryLock.acquireShared();
        reserveAndLockFrames(job, generation);
        jdbc.sql(candidates).param("job", job).param("generation", generation)
            .param("force", current.forceOverwrite()).update();

        for (var statement : dimensions) {
            statements.execute(statement);
        }
        statements.update("""
            UPDATE frame_version v SET is_current = false, valid_to = c.transition_at
            FROM import_delta_candidates c
            WHERE v.version_id = c.previous_id AND c.is_current AND c.outcome IN ('APPLY', 'APPLY_FORCE')
            """);
        jdbc.sql(versions).param("job", job).update();
        writeChildren(job);
        writeErrors(job);
        finish(job);
        staging.clear(job);
        return true;
    }

    @Transactional
    public void fail(UUID job, String code) {
        int updated = jdbc.sql("""
                UPDATE import_jobs SET status = 'FAILED', finished_at = clock_timestamp(), failure_code = :code
                WHERE job_id = :job AND status = 'RUNNING'
                """).param("job", job).param("code", code).update();
        if (updated == 1) {
            staging.clear(job);
        }
    }

    private boolean complete(UUID job, UUID generation) {
        return jdbc.sql("""
                SELECT EXISTS (
                    SELECT 1 FROM stg_inventory_import_completion m
                    WHERE m.job_id = :job AND m.generation = :generation AND m.row_count = (
                        SELECT count(*) FROM stg_inventory_import s
                        WHERE s.job_id = m.job_id AND s.generation = m.generation
                    )
                )
                """).param("job", job).param("generation", generation).query(Boolean.class).single();
    }

    private void reserveAndLockFrames(UUID job, UUID generation) {
        jdbc.sql("""
                INSERT INTO frame (frame_id)
                SELECT frame_id FROM stg_inventory_import
                WHERE job_id = :job AND generation = :generation AND frame_id IS NOT NULL
                GROUP BY frame_id HAVING count(*) = 1 AND bool_and(payload IS NOT NULL)
                ORDER BY frame_id ON CONFLICT (frame_id) DO NOTHING
                """).param("job", job).param("generation", generation).update();
        jdbc.sql("""
                SELECT f.frame_id FROM frame f
                JOIN (
                    SELECT frame_id FROM stg_inventory_import
                    WHERE job_id = :job AND generation = :generation AND frame_id IS NOT NULL
                    GROUP BY frame_id HAVING count(*) = 1 AND bool_and(payload IS NOT NULL)
                ) s USING (frame_id)
                ORDER BY f.frame_id FOR UPDATE OF f
                """).param("job", job).param("generation", generation).query(String.class).list();
    }

    private void writeChildren(UUID job) {
        jdbc.sql("""
                INSERT INTO frame_version_external_reference (version_id, reference_type, reference_value)
                SELECT v.version_id, ref.key, ref.value
                FROM import_delta_candidates c
                JOIN frame_version v ON v.frame_id = c.frame_id AND v.import_job_id = :job AND v.is_current
                CROSS JOIN LATERAL jsonb_each_text(c.payload -> 'refs') ref
                WHERE c.outcome IN ('APPLY', 'APPLY_FORCE')
                """).param("job", job).update();
        jdbc.sql("""
                INSERT INTO frame_version_link (version_id, position, linked_frame_id)
                SELECT v.version_id, link.position, link.target
                FROM import_delta_candidates c
                JOIN frame_version v ON v.frame_id = c.frame_id AND v.import_job_id = :job AND v.is_current
                CROSS JOIN LATERAL jsonb_array_elements_text(c.payload -> 'links') WITH ORDINALITY link(target, position)
                WHERE c.outcome IN ('APPLY', 'APPLY_FORCE')
                """).param("job", job).update();
    }

    private void writeErrors(UUID job) {
        jdbc.sql("""
                INSERT INTO import_row_errors (job_id, row_number, code, frame_id, detail)
                SELECT :job, row_number, outcome, frame_id,
                    CASE outcome
                        WHEN 'DUPLICATE_FRAME_ID' THEN 'More than one record has this frame ID.'
                        WHEN 'MANUALLY_DELETED' THEN 'Restoring a manually deleted frame requires force overwrite.'
                        WHEN 'STALE_RECORD' THEN 'The source modification time is older than the current frame.'
                        WHEN 'TIMESTAMP_COLLISION_CONFLICT' THEN concat(
                            'Same source modification time with different payload hashes. Current SHA-256 ',
                            encode(previous_hash, 'hex'), '; incoming SHA-256 ', encode(incoming_hash, 'hex'), '.')
                        ELSE error_detail
                    END
                FROM import_delta_candidates
                WHERE outcome NOT IN ('APPLY', 'APPLY_FORCE', 'UNCHANGED')
                """).param("job", job).update();
    }

    private void finish(UUID job) {
        jdbc.sql("""
                UPDATE import_jobs SET finished_at = clock_timestamp(),
                    status = CASE WHEN totals.rejected > 0 THEN 'COMPLETED_WITH_ERRORS' ELSE 'COMPLETED' END,
                    rows_read = totals.read, rows_applied = totals.applied,
                    rows_unchanged = totals.unchanged, rows_rejected = totals.rejected
                FROM (
                    SELECT count(*) AS read,
                           count(*) FILTER (WHERE outcome IN ('APPLY', 'APPLY_FORCE')) AS applied,
                           count(*) FILTER (WHERE outcome = 'UNCHANGED') AS unchanged,
                           count(*) FILTER (WHERE outcome NOT IN ('APPLY', 'APPLY_FORCE', 'UNCHANGED')) AS rejected
                    FROM import_delta_candidates
                ) totals WHERE job_id = :job
                """).param("job", job).update();
    }

    private static String sql(String filename) {
        try {
            return new ClassPathResource("inventory-import/" + filename).getContentAsString(StandardCharsets.UTF_8);
        } catch (IOException error) {
            throw new UncheckedIOException(error);
        }
    }

    private record Claim(String status, UUID stagingGeneration, boolean forceOverwrite) {}
}

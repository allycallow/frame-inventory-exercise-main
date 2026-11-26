package com.global.ct.frameinventory.inventoryimport;

import java.sql.Types;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
class ImportStaging {
    private final JdbcClient jdbc;
    private final NamedParameterJdbcTemplate batches;

    ImportStaging(JdbcClient jdbc, NamedParameterJdbcTemplate batches) {
        this.jdbc = jdbc;
        this.batches = batches;
    }

    @Transactional
    public Optional<ObjectVersion> claim(UUID job, UUID generation, int sequence) {
        var input = jdbc.sql("""
                UPDATE import_jobs
                SET status = 'RUNNING', staging_generation = :generation, staging_sequence = :sequence
                WHERE job_id = :job AND status IN ('PENDING', 'RUNNING')
                  AND import_mode = 'DELTA' AND object_version_id IS NOT NULL AND staging_sequence < :sequence
                RETURNING object_bucket, object_key, object_version_id
                """).param("job", job).param("generation", generation).param("sequence", sequence)
            .query(ObjectVersion.class).optional();
        if (input.isPresent()) {
            clear(job);
        }
        return input;
    }

    @Transactional
    public void append(UUID job, UUID generation, List<InventoryCsvReader.Row> rows) {
        requireClaim(job, generation);
        batches.batchUpdate("""
            INSERT INTO stg_inventory_import (job_id, generation, row_number, frame_id, payload, error_code, error_detail)
            VALUES (:job, :generation, :number, :frame, CAST(:payload AS jsonb), :code, :detail)
            """, rows.stream().map(row -> new MapSqlParameterSource()
                .addValue("job", job).addValue("generation", generation).addValue("number", row.number())
                .addValue("frame", row.frameId(), Types.VARCHAR).addValue("payload", row.payload(), Types.VARCHAR)
                .addValue("code", row.errorCode(), Types.VARCHAR).addValue("detail", row.errorDetail(), Types.VARCHAR))
            .toArray(MapSqlParameterSource[]::new));
    }

    @Transactional
    public void complete(UUID job, UUID generation, int rows) {
        requireClaim(job, generation);
        jdbc.sql("""
                INSERT INTO stg_inventory_import_completion (job_id, generation, row_count)
                VALUES (:job, :generation, :rows)
                """).param("job", job).param("generation", generation).param("rows", rows).update();
    }

    void clear(UUID job) {
        jdbc.sql("DELETE FROM stg_inventory_import_completion WHERE job_id = :job").param("job", job).update();
        jdbc.sql("DELETE FROM stg_inventory_import WHERE job_id = :job").param("job", job).update();
    }

    private void requireClaim(UUID job, UUID generation) {
        if (jdbc.sql("""
                SELECT job_id FROM import_jobs
                WHERE job_id = :job AND status = 'RUNNING' AND staging_generation = :generation FOR UPDATE
                """).param("job", job).param("generation", generation).query(UUID.class).optional().isEmpty()) {
            throw new IllegalStateException("Import staging attempt no longer owns the job");
        }
    }

    record ObjectVersion(String objectBucket, String objectKey, String objectVersionId) {}
}

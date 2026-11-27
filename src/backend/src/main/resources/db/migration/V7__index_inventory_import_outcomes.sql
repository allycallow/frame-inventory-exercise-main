CREATE INDEX import_jobs_delta_finished_idx
    ON import_jobs (finished_at, status)
    WHERE import_mode = 'DELTA' AND finished_at IS NOT NULL;

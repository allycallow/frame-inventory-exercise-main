CREATE INDEX import_jobs_active_age_idx
    ON import_jobs (status, (COALESCE(dispatch_confirmed_at, created_at)))
    WHERE status IN ('PENDING', 'RUNNING');

CREATE INDEX import_jobs_dispatch_failures_idx
    ON import_jobs (finished_at)
    WHERE status = 'FAILED' AND failure_code = 'DISPATCH_FAILED';

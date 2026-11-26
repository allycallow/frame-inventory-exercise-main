ALTER TABLE import_jobs
    ADD COLUMN dispatch_confirmed_at timestamptz,
    ADD CONSTRAINT import_jobs_dispatch_confirmation_requires_version
        CHECK (dispatch_confirmed_at IS NULL OR object_version_id IS NOT NULL);

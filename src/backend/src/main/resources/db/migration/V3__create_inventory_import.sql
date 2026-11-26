CREATE TABLE import_jobs (
    job_id uuid PRIMARY KEY,
    owner_id text NOT NULL,
    import_mode text NOT NULL CHECK (import_mode IN ('DELTA', 'FULL_SNAPSHOT')),
    force_overwrite boolean NOT NULL,
    status text NOT NULL CHECK (status IN (
        'AWAITING_UPLOAD', 'PENDING', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'EXPIRED'
    )),
    object_bucket text NOT NULL CHECK (btrim(object_bucket) <> ''),
    object_key text NOT NULL UNIQUE CHECK (object_key = 'uploads/' || job_id::text || '/inventory_frame.csv'),
    object_version_id text CHECK (btrim(object_version_id) NOT IN ('', 'null')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    upload_expires_at timestamptz NOT NULL,
    dispatch_until timestamptz NOT NULL CHECK (dispatch_until >= upload_expires_at),
    finished_at timestamptz,
    rows_read integer NOT NULL DEFAULT 0 CHECK (rows_read >= 0),
    rows_applied integer NOT NULL DEFAULT 0 CHECK (rows_applied >= 0),
    rows_unchanged integer NOT NULL DEFAULT 0 CHECK (rows_unchanged >= 0),
    rows_rejected integer NOT NULL DEFAULT 0 CHECK (rows_rejected >= 0),
    frames_retired integer NOT NULL DEFAULT 0 CHECK (frames_retired >= 0),
    failure_code text,
    CHECK (rows_applied + rows_unchanged + rows_rejected <= rows_read),
    CHECK ((status IN ('COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'EXPIRED')) = (finished_at IS NOT NULL)),
    CHECK (status NOT IN ('PENDING', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS') OR object_version_id IS NOT NULL)
);

CREATE INDEX import_jobs_dispatch_deadline_idx ON import_jobs (dispatch_until)
    WHERE status = 'AWAITING_UPLOAD';

CREATE TABLE import_row_errors (
    job_id uuid NOT NULL REFERENCES import_jobs (job_id),
    row_number integer NOT NULL CHECK (row_number > 0),
    code text NOT NULL,
    frame_id text,
    detail text NOT NULL,
    PRIMARY KEY (job_id, row_number, code)
);

CREATE UNLOGGED TABLE stg_inventory_import (
    job_id uuid NOT NULL,
    generation uuid NOT NULL,
    row_number integer NOT NULL CHECK (row_number > 0),
    frame_id text,
    payload jsonb,
    PRIMARY KEY (job_id, generation, row_number)
);

CREATE INDEX stg_inventory_import_present_idx ON stg_inventory_import (job_id, generation, frame_id);

CREATE UNLOGGED TABLE stg_inventory_import_completion (
    job_id uuid NOT NULL,
    generation uuid NOT NULL,
    row_count integer NOT NULL CHECK (row_count >= 0),
    PRIMARY KEY (job_id, generation)
);

ALTER TABLE frame_version ADD COLUMN import_job_id uuid REFERENCES import_jobs (job_id);

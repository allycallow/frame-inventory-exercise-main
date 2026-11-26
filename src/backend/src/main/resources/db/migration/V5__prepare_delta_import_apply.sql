ALTER TABLE import_jobs
    ADD COLUMN staging_generation uuid,
    ADD COLUMN staging_sequence integer NOT NULL DEFAULT 0;

ALTER TABLE stg_inventory_import
    ADD COLUMN error_code text,
    ADD COLUMN error_detail text;

ALTER TABLE frame_version ADD COLUMN legacy_manual_source boolean NOT NULL DEFAULT false;

UPDATE frame_version SET legacy_manual_source = true
WHERE change_source IN ('MANUAL_CREATE', 'MANUAL_EDIT');

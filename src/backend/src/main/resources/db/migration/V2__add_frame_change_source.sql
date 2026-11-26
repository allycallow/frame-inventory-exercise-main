ALTER TABLE frame_version
    ADD COLUMN change_source text,
    ADD COLUMN closed_by_change_source text,
    ADD CONSTRAINT frame_version_delete_requires_closure CHECK (
        closed_by_change_source IS NULL OR (closed_by_change_source = 'MANUAL_DELETE' AND NOT is_current)
    );

CREATE TEMP TABLE import_delta_candidates ON COMMIT DROP AS
WITH staged AS (
    SELECT s.*, count(*) OVER (PARTITION BY frame_id) AS copies
    FROM stg_inventory_import s
    WHERE job_id = :job AND generation = :generation
), previous AS (
    SELECT s.*, v.version_id AS previous_id, v.is_current, v.valid_from, v.valid_to,
           v.closed_by_change_source,
           CASE WHEN v.legacy_manual_source OR v.source_modified_at IS NULL
                THEN v.valid_from AT TIME ZONE 'UTC' ELSE v.source_modified_at END AS baseline,
           (s.payload ->> 'source_modified_at')::timestamp AS incoming_timestamp,
           sha256(convert_to('inventory-frame-payload-v1:' || (s.payload - ARRAY['source_created_at', 'source_modified_at'])::text, 'UTF8')) AS incoming_hash,
           sha256(convert_to('inventory-frame-payload-v1:' || (
               (to_jsonb(v) - ARRAY['version_id', 'frame_id', 'postcode_id', 'frame_format_id',
                   'source_created_at', 'source_modified_at', 'valid_from', 'valid_to', 'is_current',
                   'change_source', 'closed_by_change_source', 'import_job_id', 'legacy_manual_source'])
               || jsonb_build_object('latitude', trim_scale(v.latitude), 'longitude', trim_scale(v.longitude),
                   'impact_weight', trim_scale(v.impact_weight), 'country_code', r.country_code,
                   'region_name', r.region_name, 'town_name', t.town_name, 'postcode', p.postcode,
                   'technology_code', f.technology_code, 'format_code', f.format_code,
                   'size_group_code', f.size_group_code, 'refs', coalesce((
                       SELECT jsonb_object_agg(ref.reference_type, ref.reference_value)
                       FROM frame_version_external_reference ref WHERE ref.version_id = v.version_id
                   ), '{}'::jsonb), 'links', coalesce((
                       SELECT jsonb_agg(link.linked_frame_id ORDER BY link.position)
                       FROM frame_version_link link WHERE link.version_id = v.version_id
                   ), '[]'::jsonb))
           )::text, 'UTF8')) AS previous_hash
    FROM staged s
    LEFT JOIN LATERAL (
        SELECT fv.* FROM frame_version fv
        WHERE fv.frame_id = s.frame_id AND s.payload IS NOT NULL AND s.copies = 1
        ORDER BY fv.is_current DESC, fv.valid_from DESC, fv.version_id DESC LIMIT 1
    ) v ON true
    LEFT JOIN postcode p ON p.postcode_id = v.postcode_id
    LEFT JOIN town t ON t.town_id = p.town_id
    LEFT JOIN region r ON r.region_id = t.region_id
    LEFT JOIN frame_format f ON f.frame_format_id = v.frame_format_id
)
SELECT row_number, frame_id, payload, error_detail, previous_id, is_current, previous_hash, incoming_hash,
       CASE
           WHEN frame_id IS NOT NULL AND copies > 1 THEN 'DUPLICATE_FRAME_ID'
           WHEN error_code IS NOT NULL THEN error_code
           WHEN previous_id IS NULL THEN 'APPLY'
           WHEN NOT is_current AND closed_by_change_source = 'MANUAL_DELETE'
               THEN CASE WHEN :force THEN 'APPLY_FORCE' ELSE 'MANUALLY_DELETED' END
           WHEN incoming_timestamp > baseline THEN 'APPLY'
           WHEN incoming_timestamp = baseline AND incoming_hash = previous_hash THEN 'UNCHANGED'
           WHEN :force THEN 'APPLY_FORCE'
           WHEN incoming_timestamp < baseline THEN 'STALE_RECORD'
           ELSE 'TIMESTAMP_COLLISION_CONFLICT'
       END AS outcome,
       CASE WHEN previous_id IS NULL THEN clock_timestamp()
            ELSE greatest(clock_timestamp(), valid_from + interval '1 microsecond', valid_to)
       END AS transition_at
FROM previous

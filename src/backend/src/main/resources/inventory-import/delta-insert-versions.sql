INSERT INTO frame_version (
    frame_id, postcode_id, frame_format_id, source_created_at, source_modified_at, valid_from,
    import_job_id, change_source, status, status_reason, site_no, inventory_site_no, panel_number,
    location_id, environment, address, station, airport, latitude, longitude, distance_to_closest_school,
    size_code, aspect_ratio_code, t_size, pixel_height, pixel_width, illumination_type_id, number_of_slots,
    impact_weight, premium, production_rate_card, production_rate_card_legacy, pricing_grade
)
SELECT c.frame_id, p.postcode_id, f.frame_format_id, value.source_created_at, value.source_modified_at,
       c.transition_at, :job, CASE c.outcome WHEN 'APPLY_FORCE' THEN 'FORCED_OVERWRITE' ELSE 'CSV_IMPORT' END,
       value.status, value.status_reason, value.site_no, value.inventory_site_no, value.panel_number,
       value.location_id, value.environment, value.address, value.station, value.airport, value.latitude,
       value.longitude, value.distance_to_closest_school, value.size_code, value.aspect_ratio_code, value.t_size,
       value.pixel_height, value.pixel_width, value.illumination_type_id, value.number_of_slots,
       value.impact_weight, value.premium, value.production_rate_card, value.production_rate_card_legacy,
       value.pricing_grade
FROM import_delta_candidates c
CROSS JOIN LATERAL jsonb_populate_record(NULL::frame_version, c.payload) value
LEFT JOIN region r ON r.country_code = c.payload ->> 'country_code'
                  AND r.region_name = c.payload ->> 'region_name'
LEFT JOIN town t ON t.region_id = r.region_id AND t.town_name = c.payload ->> 'town_name'
LEFT JOIN postcode p ON p.town_id = t.town_id AND p.postcode = c.payload ->> 'postcode'
LEFT JOIN frame_format f ON f.technology_code = c.payload ->> 'technology_code'
    AND f.format_code = c.payload ->> 'format_code' AND f.size_group_code = c.payload ->> 'size_group_code'
WHERE c.outcome IN ('APPLY', 'APPLY_FORCE')

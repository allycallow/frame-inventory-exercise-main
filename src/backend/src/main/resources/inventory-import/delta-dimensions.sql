INSERT INTO region (country_code, region_name)
SELECT DISTINCT payload ->> 'country_code', payload ->> 'region_name'
FROM import_delta_candidates
WHERE outcome IN ('APPLY', 'APPLY_FORCE') AND payload ->> 'country_code' IS NOT NULL
ORDER BY 1, 2
ON CONFLICT (country_code, region_name) DO NOTHING;

INSERT INTO town (region_id, town_name)
SELECT DISTINCT r.region_id, c.payload ->> 'town_name'
FROM import_delta_candidates c
JOIN region r ON r.country_code = c.payload ->> 'country_code' AND r.region_name = c.payload ->> 'region_name'
WHERE c.outcome IN ('APPLY', 'APPLY_FORCE')
ORDER BY 1, 2
ON CONFLICT (region_id, town_name) DO NOTHING;

INSERT INTO postcode (town_id, postcode)
SELECT DISTINCT t.town_id, c.payload ->> 'postcode'
FROM import_delta_candidates c
JOIN region r ON r.country_code = c.payload ->> 'country_code' AND r.region_name = c.payload ->> 'region_name'
JOIN town t ON t.region_id = r.region_id AND t.town_name = c.payload ->> 'town_name'
WHERE c.outcome IN ('APPLY', 'APPLY_FORCE')
ORDER BY 1, 2
ON CONFLICT (town_id, postcode) DO NOTHING;

INSERT INTO frame_format (technology_code, format_code, size_group_code)
SELECT DISTINCT payload ->> 'technology_code', payload ->> 'format_code', payload ->> 'size_group_code'
FROM import_delta_candidates
WHERE outcome IN ('APPLY', 'APPLY_FORCE') AND payload ->> 'technology_code' IS NOT NULL
ORDER BY 1, 2, 3
ON CONFLICT (technology_code, format_code, size_group_code) DO NOTHING

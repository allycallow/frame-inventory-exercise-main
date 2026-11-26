CREATE TABLE frame (
    frame_id text PRIMARY KEY CHECK (btrim(frame_id) <> '')
);

CREATE TABLE region (
    region_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    country_code text NOT NULL,
    region_name text NOT NULL,
    UNIQUE (country_code, region_name)
);

CREATE TABLE town (
    town_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    region_id bigint NOT NULL REFERENCES region (region_id),
    town_name text NOT NULL,
    UNIQUE (region_id, town_name)
);

CREATE TABLE postcode (
    postcode_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    town_id bigint NOT NULL REFERENCES town (town_id),
    postcode text NOT NULL,
    UNIQUE (town_id, postcode)
);

CREATE TABLE frame_format (
    frame_format_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    technology_code text NOT NULL,
    format_code text NOT NULL,
    size_group_code text NOT NULL,
    UNIQUE (technology_code, format_code, size_group_code)
);

CREATE TABLE frame_version (
    version_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    frame_id text NOT NULL REFERENCES frame (frame_id),
    postcode_id bigint REFERENCES postcode (postcode_id),
    frame_format_id bigint REFERENCES frame_format (frame_format_id),

    source_created_at timestamp without time zone,
    source_modified_at timestamp without time zone,
    valid_from timestamptz NOT NULL,
    valid_to timestamptz,
    is_current boolean NOT NULL DEFAULT true,

    site_no text,
    inventory_site_no text,
    panel_number text,
    location_id text,
    environment text,
    address text,
    station text,
    airport text,
    latitude numeric CHECK (latitude BETWEEN -90 AND 90),
    longitude numeric CHECK (longitude BETWEEN -180 AND 180),
    distance_to_closest_school integer CHECK (distance_to_closest_school >= 0),

    size_code text,
    aspect_ratio_code text,
    t_size text,
    pixel_height integer CHECK (pixel_height > 0),
    pixel_width integer CHECK (pixel_width > 0),
    illumination_type_id integer,
    number_of_slots integer CHECK (number_of_slots >= 0),

    status text NOT NULL,
    status_reason text,
    impact_weight numeric,
    premium boolean NOT NULL DEFAULT false,
    production_rate_card text,
    production_rate_card_legacy text,
    pricing_grade text,

    CONSTRAINT frame_version_current_matches_validity CHECK (is_current = (valid_to IS NULL)),
    CONSTRAINT frame_version_positive_validity CHECK (valid_to > valid_from)
);

CREATE UNIQUE INDEX frame_version_one_current_idx ON frame_version (frame_id) WHERE is_current;

CREATE INDEX frame_version_history_idx ON frame_version (frame_id, valid_from DESC, version_id DESC);

CREATE TABLE frame_version_external_reference (
    version_id bigint NOT NULL REFERENCES frame_version (version_id),
    reference_type text NOT NULL,
    reference_value text NOT NULL,
    PRIMARY KEY (version_id, reference_type)
);

CREATE TABLE frame_version_link (
    version_id bigint NOT NULL REFERENCES frame_version (version_id),
    position integer NOT NULL CHECK (position > 0),
    linked_frame_id text NOT NULL CHECK (btrim(linked_frame_id) <> ''),
    PRIMARY KEY (version_id, position)
);

COMMENT ON COLUMN frame_version_link.linked_frame_id IS
    'Source frame ID. The target may arrive in a later upload.';

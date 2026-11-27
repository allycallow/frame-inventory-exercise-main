# Frame inventory schema and version history

- **Author** Alex Callow
- **Date** 2026-11-26

## Overview

PostgreSQL stores a stable `frame_id` for each frame and a separate row for each accepted version. The [Flyway migration](../../src/backend/src/main/resources/db/migration/V1__create_frame_inventory.sql) creates the empty inventory tables on Spring Boot startup.

The supplied extract contains 1,000 rows, 1,000 distinct frame IDs, and 45 fields. The exercise calls for a user-driven import. [CSV](../../data/inventory_frame.csv) [Exercise requirements](../../INSTRUCTIONS.md#L52-L64)

## CSV field mapping

CSV values arrive as text. A blank optional value becomes SQL `NULL`. Counts and value sets describe the supplied extract.

| CSV fields | Observed representation | PostgreSQL mapping |
| --- | --- | --- |
| `frame_id` | Ten decimal digits, unique and populated in all rows | `frame.frame_id text` primary key. The prototype also uses alphanumeric frame IDs. |
| `created_date`, `modified_date` | Date and time to seconds, without offsets | `frame_version.source_created_at` and `source_modified_at`, both `timestamp without time zone`. |
| `country_code`, `region`, `town` | Codes and names. One country, 12 regions, 172 towns | Country code and region name form the region's natural key. Town name is scoped to a region. Each table also has a generated primary key. |
| `postcode` | UK postcode with a space, 484 distinct | `postcode` row keyed by generated ID, unique on `(town_id, postcode)`. |
| `postcode_area`, `postcode_district`, `postcode_sector`, `postcode_unit` | Text fragments, some containing letters | Derive from the postcode. The four fragments reconstruct it exactly in all 1,000 rows. |
| `longitude`, `latitude` | Signed decimal degrees | Exact `numeric` columns on `frame_version`, with valid coordinate ranges. |
| `location` | `POINT (latitude longitude)` text | Derive from the scalar coordinates if an export requires the legacy format. All 1,000 rows contain the same pair in this order. |
| `site_no`, `inventory_site_no`, `panel_number` | Identifiers. Site and panel numbers can contain leading zeros | Independent `text` fields on `frame_version`. |
| `location_id` | Identifier, 13 blanks | Nullable `text` on `frame_version`. In 67 rows the populated value differs from the normalized postcode. |
| `environment`, `address`, `station`, `airport` | Text. Station has 593 blanks and airport has 887 | `text` on `frame_version`, with the optional site names nullable. |
| `type_classic_digital`, `format`, `size_group_code` | Codes. Nine distinct combinations | `frame_format` row keyed by generated ID, unique on the three codes. Codes stay as text, including size groups such as `006`. |
| `size_code`, `aspect_ratio_code`, `t_size` | Codes and labels. `t_size` has 57 blanks | `text` columns on `frame_version`. |
| `pixel_height`, `pixel_width` | Positive integers, 28 blanks in each column | Nullable `integer` dimensions on `frame_version`. |
| `illumination_type_id`, `number_of_slots`, `distance_to_closest_school` | Integer code, count, and distance | `integer` on `frame_version`. The distance is assumed to be in metres, consistent with the prototype. |
| `status`, `status_reason` | Text. Every row is `LIVE` and all reasons are blank | Status and nullable reason on `frame_version`. |
| `impact_weight` | Decimal, six blanks | Nullable exact `numeric` on `frame_version`. |
| `premium` | `0` or `1` | `boolean` on `frame_version`. |
| `production_rate_card`, `production_rate_card_legacy` | Both columns are blank throughout | Separate nullable `text` fields until the source contract establishes how they relate. |
| `pricing_grade` | Text, 869 blanks | Nullable `text` on `frame_version`. |
| `price_entity_id`, `broadsign_display_unit_id`, `broadsign_frame_id`, `broadsign_domain_id` | Opaque codes. Broadsign fields have 3, 979, and 29 blanks respectively | `frame_version_external_reference` rows keyed by `(version_id, reference_type)`, with identifier values as text. Values can recur across frames. |
| `linked_frame_ids` | Comma-separated IDs, present in four rows | Ordered `frame_version_link` rows keyed by `(version_id, position)`, with each target ID as text. Each supplied list includes its source frame and a peer. |

## Relational structure

- `frame_version` has a primary key and foreign keys to `frame`, `postcode`, and `frame_format`. `postcode` references `town`, which references `region`. When lookup values change, the writer creates or reuses a row with the new values so earlier versions keep their original values.
- External references and linked frame IDs belong to the version that carried them. Both child tables reference that version. Resolve a linked target by joining its source ID to `frame.frame_id`. This lets a partial upload preserve a reference before its target arrives.
- Keep address, position, and coordinates on the version. Eight `site_no` values map to multiple `inventory_site_no` values, and 95 `inventory_site_no` values map to multiple `site_no` values. Even matching pairs can have different coordinates and addresses.
- Store format and size-group codes independently in the format tuple. Their values line up one-to-one in this extract. A wider export may contain combinations absent here. Status, technology, and slot count also vary in the intended product even though each is uniform in this sample.

## Versioning contract

| Incoming CSV row | Result |
| --- | --- |
| First row for a frame | Insert the stable frame and its first current version. |
| Strictly older source `modified_date` | Record `STALE_RECORD` unless force overwrite is authorized. |
| Equal source `modified_date` and equal canonical hash | Count the row as unchanged. |
| Equal source `modified_date` and different canonical hash | Record `TIMESTAMP_COLLISION_CONFLICT` unless force overwrite is authorized. |
| Newer source `modified_date` or forced correction | Close the current version and append its replacement at the same transition instant. |
| Reappearance after manual deletion | Restore only when force overwrite is authorized. |

The migration uses `timestamptz` for half-open validity intervals
`[valid_from, valid_to)`. Check constraints require a positive interval for
closed versions and tie `is_current` to whether `valid_to` is null. A partial
unique index enforces at most one current version per frame. A replacement
opens at a database-generated instant strictly after the previous version
started. CSV source timestamps are stored as offset-free UTC values.

DELTA and manual writes coordinate through the shared transaction lock and
stable frame IDs. DELTA re-reads history under the locks and hashes the
canonical typed payload, including references and ordered links. Manual
writes stamp the source time in UTC after locking. The migration flags older
manual versions so imports compare them against their recorded start.
A forced correction preserves the CSV source time and records the import
job ID and `FORCED_OVERWRITE` on the new version.

## Alternatives weighed

- One wide mutable row has a simple current read and loses revisions. A second mutable current table would duplicate the version data and require another write on each transition. Index the current versions in the history table.
- One table per category code would add joins and introduce catalog rules that the extract cannot establish. Share the repeated region, town, postcode, and format tuples and keep frame-specific values with each historical version.
- A foreign key from each linked target to an existing frame gives immediate referential integrity and forces partial uploads to wait for every target. Preserve each source target identifier and enforce the owner foreign key. An unresolved target can join to its frame once that frame arrives.

## Scope and verification

Flyway V1 defines the inventory tables and validity constraints. Later migrations add import jobs, staging, dispatch confirmation, and legacy manual source provenance. DELTA writes an imported version and its job result in one transaction.

Flyway applied V1 on PostgreSQL 18.6 and skipped it on restart. A rollback-only check loaded all 1,000 CSV rows and exercised the database constraints. The [backend README](../../src/backend/README.md) describes how to verify the migration using `flyway_schema_history`.

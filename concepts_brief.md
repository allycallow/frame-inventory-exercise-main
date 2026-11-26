# Frame inventory schema and version history

- **Author** Alex Callow
- **Date** 2026-11-26

## Overview

Use PostgreSQL to store frames and their accepted versions. Each `frame_id` identifies one frame through successive uploads. An incoming row whose `modified_date` is strictly older than the current row is ignored. An equal or newer value closes the previous version and opens the next version at the same import instant.

The supplied extract has 1,000 rows, 1,000 distinct frame IDs, and 45 fields. The migration will create the schema on Spring Boot startup. The exercise calls for a user-driven CSV upload, so the migration will start with empty inventory tables. [CSV](./data/inventory_frame.csv) [Exercise requirements](./INSTRUCTIONS.md#L52-L64)

## Analysis

### Raw field mapping

CSV values arrive as text. The types below describe how to parse them for PostgreSQL. A blank optional value becomes SQL `NULL`. Observed null counts and value sets describe this extract.

| CSV fields | Observed representation | Proposed PostgreSQL mapping |
| --- | --- | --- |
| `frame_id` | Ten decimal digits, unique and populated in all rows | `frame.frame_id text` primary key. The prototype also uses alphanumeric frame IDs. |
| `created_date`, `modified_date` | Date and time to seconds, without offsets | `frame_version` source timestamps, `timestamp without time zone`. |
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
| `illumination_type_id`, `number_of_slots`, `distance_to_closest_school` | Integer code and counts or distances | `integer` on `frame_version`. The proposed distance unit is metres, consistent with the prototype. |
| `status`, `status_reason` | Text. Every row is `LIVE` and all reasons are blank | Status and nullable reason on `frame_version`. |
| `impact_weight` | Decimal, six blanks | Nullable exact `numeric` on `frame_version`. |
| `premium` | `0` or `1` | `boolean` on `frame_version`. |
| `production_rate_card`, `production_rate_card_legacy` | Both columns are blank throughout | Separate nullable `text` fields until the source contract establishes how they relate. |
| `pricing_grade` | Text, 869 blanks | Nullable `text` on `frame_version`. |
| `price_entity_id`, `broadsign_display_unit_id`, `broadsign_frame_id`, `broadsign_domain_id` | Opaque codes. Broadsign fields have 3, 979, and 29 blanks respectively | `frame_version_external_reference` rows keyed by `(version_id, reference_type)`, with identifier values as text. Values can recur across frames. |
| `linked_frame_ids` | Comma-separated IDs, present in four rows | Ordered `frame_version_link` rows keyed by `(version_id, position)`, with each target ID as text. Each supplied list includes its source frame and a peer. |

### Relational boundaries

- `frame_version` has its own primary key and foreign keys to `frame`, `postcode`, and `frame_format`. `postcode` references `town`, which references `region`. Historical versions keep their original lookup rows. A changed tuple gets its own row so earlier versions retain their values.
- External references and linked frame IDs belong to the version that carried them. Both child tables reference that version. Resolve a linked target by joining its source ID to `frame.frame_id`. This lets a partial upload preserve a reference before its target arrives.
- Keep grain at the observed frame for address, position, and coordinates. Eight distinct `site_no` values map to more than one `inventory_site_no`. The reverse has 95 collisions. Even the pair groups several distinct coordinates and addresses. Treating either identifier or the pair as the key for physical location would discard data.
- Store format and size-group codes independently in the format tuple. Their values line up one-to-one in this extract. A wider export may contain combinations absent here. Status, technology, and slot count also vary in the intended product even though each is uniform in this sample.

### Version and write rules

| Incoming row | Result |
| --- | --- |
| First row for a frame | Insert the stable frame and its first current version. |
| Strictly older source `modified_date` | Leave the current row, links, and history as they were. |
| Equal or newer source `modified_date` | Set the old row's `is_current` to false and its `valid_to` to the transition instant. Insert a current version with `valid_from` set to that same instant. |

Use `timestamptz` for validity. The source timestamps retain their original wall-clock values for comparison. Version intervals are half-open, `[valid_from, valid_to)`, with `valid_to` null on a current version. A check constraint ties `is_current` to whether `valid_to` is null and requires a positive closed interval. A partial unique index enforces at most one current version per frame.

The operation that accepts a row must create or lock the stable frame row before comparing timestamps. Close and append together in one transaction. Assign the transition instant after acquiring the lock, and make it strictly later than the previous start, including two accepted rows in the same transaction. A partial unique index alone cannot decide whether an upload is stale. Equal-timestamp uploads intentionally append history, including an exact replay. The initial file has one snapshot per frame, so its source timestamps cannot reconstruct earlier revisions. Preserve the last accepted source timestamp when the future UI edit workflow writes a new version.

## Goals and scope

- Deliver a versioned PostgreSQL Flyway migration and wire Spring Boot to apply it during database-backed startup. Reuse the PostgreSQL service and configure startup to wait for readiness. Verify the migration history on first start and restart. The custom `/api/health` response alone cannot verify that the migration ran. [Spring Boot database initialization](https://docs.spring.io/spring-boot/how-to/data-initialization.html) [PostgreSQL constraints](https://www.postgresql.org/docs/18/ddl-constraints.html)
- Leave CSV parsing, upload endpoints, manual edit endpoints, and history views for their feature work. Keep an ordinary Spring context smoke test usable and verify PostgreSQL-specific DDL on PostgreSQL.

## Alternatives weighed

- One wide mutable row has a simple current read and loses revisions. A second mutable current table would duplicate the version data and require another write on each transition. Index the current versions in the history table.
- One table per category code would add joins and introduce catalog rules that the extract cannot establish. Share the repeated region, town, postcode, and format tuples and keep frame-specific values with each historical version.
- A foreign key from each linked target to an existing frame gives immediate referential integrity and forces partial uploads to wait for every target. Preserve each source target identifier and enforce the owner foreign key. An unresolved target can join to its frame once that frame arrives.

## Key decisions and implementation staging

The comparison rule and replay behavior are confirmed. Start by creating the referenced tables and their keys, then the version and child tables. Add the current-version index, history index, and validity checks. Wire Flyway into Spring Boot, verify the DDL and a restart on PostgreSQL, and check that every one of the 45 CSV fields has a documented destination or derivation.

The migration owns the schema, keys, validity checks, and indexes. The future
CSV upload, create, and edit paths will call a shared Spring
`@Transactional` service for the stable-row lock and close-and-append
operation. The CSV path supplies `source_modified_at` for the stale check.
Manual edits carry forward the previous source timestamp. Manual creation can
start with null source timestamps.

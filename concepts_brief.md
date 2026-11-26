# Frame Management gRPC API

- **Author** Alex Callow
- **Date** 2026-11-26

## Overview

Inventory users need to browse current frames, open and edit a frame, and understand how it changed. A Spring Boot gRPC service uses the existing PostgreSQL model. A stable frame ID links the versions, and each version records the period during which its values applied. A deleted frame disappears from current inventory and remains available in history. An ID is reserved permanently after its first use.

## Analysis

**Deletion preserves the version’s origin.** A create followed by a delete would lose its `MANUAL_CREATE` source if DELETE overwrote `change_source`. Keep `change_source` as the origin of the version and record `MANUAL_DELETE` in nullable `closed_by_change_source`. The existing `valid_to` records when deletion took effect. The API can show both actions from one row.

**Write races must be handled in the database transaction.** Insert the stable frame ID under its primary key for POST. Use its row lock for PUT and DELETE, then read and compare the current version under that lock. Calculate the transition instant after locking and ensure it is at least one PostgreSQL microsecond after the current version’s start. Reuse the same instant for the old version’s `valid_to` and the new version’s `valid_from`. A failed append rolls back the close. [PostgreSQL row locks](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS) [PostgreSQL time functions](https://www.postgresql.org/docs/18/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT)

**Editing preserves source data outside the request.** PUT replaces the writable attributes and copies source timestamps, external references, and ordered linked frame IDs. When the request changes a normalized lookup value, create or reuse the matching lookup tuple so old versions still reference their original values. The CSV implementation is a separate task. Its writer must honor the same stable-row lock and leave retired IDs retired. [Versioned schema](docs/frame-inventory-schema/frame-inventory-schema.md)

**Read costs match the supplied inventory.** Use offset pagination over ordered frame IDs and compute offsets safely for large page numbers. Reads on separate requests can see intervening writes. Full history is the requested contract and may grow independently of the inventory count. Use the existing history index order, batch related reads if needed, and revisit history pagination when actual history sizes warrant it.

## Goals and scope

- Expose six frame RPCs. Preserve historical snapshots, prevent ID reuse, and reject conflicting writes using version IDs.
- Validate Protobuf requests. Return field-level details for validation errors and distinguish missing frames, stale versions, and reserved IDs.
- Verify the service and gRPC contract against the backend’s normal Gradle test command, including real PostgreSQL and Flyway for integration tests.
- Defer search, structured filtering, CSV import, frontend changes, and new telemetry infrastructure. Existing logging and MVC observations can help diagnose failures. Keep frame IDs, version IDs, and request payloads out of metric labels.

## Alternatives weighed

- **Infer deletion from a closed final row.** This saves one column if every other closure always has a successor. It gives history readers a new inference to make, and future writers would have to preserve that assumption. Explicit closure metadata is simpler to interpret.
- **Append a tombstone version or add an audit events table.** Either can preserve both actions. A tombstone changes the meaning of a current version, and an events table adds a second write and read model. The existing validity interval already records the deletion time.
- **Use transport metadata for write preconditions.** Put the expected version ID in the request message so generated clients can work with it directly. Clients should send the version they displayed when confirming a delete.
- **Use cursor pagination or a separate current table.** Cursors can help large or frequently changing lists, and a second table can simplify reads at the cost of another write. The supplied inventory fits offset pagination over the existing current-version index.

## Key decisions and staging for next steps

### gRPC contract

| RPC | Success | Missing or conflicting state |
| --- | --- | --- |
| `ListFrames` | Current frames in ascending text frame ID order, with page, size, and whether another page exists. Default page `0`, default size `25`, maximum size `50`. An out-of-range page has empty items. | `INVALID_ARGUMENT` for invalid pagination. |
| `GetFrame` | The current version, including its version ID. | `NOT_FOUND` for an unknown or retired ID. |
| `GetFrameHistory` | All versions for a known ID, including retired IDs. Sort by `valid_from DESC`, then `version_id DESC`. | `NOT_FOUND` for an unknown ID. |
| `CreateFrame` | The created version with source `MANUAL_CREATE`. | `ALREADY_EXISTS` for any previously used ID. |
| `UpdateFrame` | The replacement version with its new version ID and source `MANUAL_EDIT`. | `NOT_FOUND` for an unknown ID. `ABORTED` if the expected version differs from the current version or the known frame has been retired. |
| `DeleteFrame` | An empty response after closing the current version with `MANUAL_DELETE`. Repeating without a version token succeeds for a retired ID. | `NOT_FOUND` for an unknown ID. `ABORTED` if the supplied expected version differs from the current version or the known frame has been retired. |

`DeleteFrame` without a token applies to the version current at the time the row is locked. Frame IDs are case-sensitive. `CreateFrame` accepts IDs of up to 128 characters. The `Frame` message keeps version, validity, and change-source fields separate from `attributes`. [Protobuf definition](src/backend/src/main/proto/frameinventory/v1/frames.proto)

Writes require `attributes.status`, with values `LIVE`, `PENDING`, `MAINTENANCE`, `BLOCKED`, and `DRAFT`. Optional `location` takes a complete `country_code`, `region`, `town`, and `postcode` tuple. Optional `format` takes `technology` (`CLASSIC` or `DIGITAL`), `format_code`, and `size_group_code`. Coordinates and impact weight use decimal strings to preserve precision. `UpdateFrame` clears omitted optional attributes and defaults omitted `premium` to `false`. Source timestamps, external references, and linked frame IDs are read-only and carry forward to the replacement version.

A Spring gRPC exception handler maps validation failures to `INVALID_ARGUMENT` with `google.rpc.BadRequest` field details. Domain errors carry a machine-readable `google.rpc.ErrorInfo` reason. Stale writes include `currentVersionId` in its metadata when a current version exists. [gRPC status codes](https://grpc.io/docs/guides/status-codes/) [gRPC error handling](https://grpc.io/docs/guides/error/)

### Migration and verification

1. Keep V1 intact and use the [V2 migration](src/backend/src/main/resources/db/migration/V2__add_frame_change_source.sql) to add nullable `change_source` and `closed_by_change_source`. Verify a fresh installation and a V1 database containing data upgraded with Flyway.
2. Use the backend’s existing Spring JDBC stack for reads and one transactional service for writes. Validate supported request fields and exercise the service with unit tests.
3. Run generated-stub gRPC integration tests through Spring Boot’s in-process test transport with Flyway and a PostgreSQL container in the normal backend Gradle `test` task. Cover all RPCs, validation and state errors, reused retired IDs, preservation of imported fields, version order and intervals, two writes racing with the same token, and rollback after a failed append.

Tracking lives on the Global team board. [GLO-2 parent](https://linear.app/upfrontbeats/issue/GLO-2/frame-management-rest-api) [GLO-3 writes](https://linear.app/upfrontbeats/issue/GLO-3/add-transactional-frame-create-edit-and-soft-delete) [GLO-4 reads](https://linear.app/upfrontbeats/issue/GLO-4/add-current-frame-and-history-endpoints) [GLO-5 validation](https://linear.app/upfrontbeats/issue/GLO-5/validate-frame-api-requests-and-standardize-error-responses) [GLO-6 tests](https://linear.app/upfrontbeats/issue/GLO-6/test-frame-versioning-and-the-rest-api)

The review covered architecture, repository fit, scope, client ergonomics, implementation readiness, document structure, and alternatives for preserving provenance.

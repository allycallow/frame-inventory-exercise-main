# FULL_SNAPSHOT safety contract

- **Author** — Alex Callow
- **Status** — Draft for backlog
- **Date** — 2026-11-27
- **Issue** — [GLO-34](https://linear.app/upfrontbeats/issue/GLO-34/define-the-full-snapshot-safety-contract)
- **Context** — [Bulk CSV inventory import](./bulk-csv-inventory-import-design.md) · [Local DELTA delivery](https://linear.app/upfrontbeats/issue/GLO-26/epic-bulk-csv-inventory-import)

## Overview

A FULL_SNAPSHOT import brings the app's frame inventory into line with a signed capture of one scope from a trusted source. It can retire a frame when the source confirms a withdrawal, record a move between scopes, and restore a snapshot-retired frame when the source confirms reinstatement. Accepted changes appear in frame history with their source evidence and import job.

The local exercise uses a controlled exporter backed by inventory separate from the app's database. This lets us demonstrate actual differences between the source and the app, including a lost export, a delayed destination snapshot, and a legitimate withdrawal. A deployed rollout depends on an upstream producer that can supply the same evidence for real inventory.

## The Problem

A CSV missing three of 100 frames can look the same whether the source withdrew those frames, moved them to another region, or stopped exporting early. All three absences fit within a 10% retirement limit. A checksum can show that a file arrived intact, but the importer also needs proof that the producer read the complete scope and evidence for each lifecycle change.

Exports can arrive in either order. The origin region can report a move before the destination region does, and a recent capture can repeat a withdrawal that an even newer source event already superseded. The app must also protect manual edits and deletions while limiting the time a snapshot transaction holds up other writes.

## Goals

- Verify the producer's signature, canonical scope, UTC capture time, expected logical record count, and checksum against the pinned CSV version before inventory writes. Accept a verified zero-row capture with a valid header under the same safeguards.
- Require signed source evidence for moves, withdrawals, and reinstatements. Keep a frame active while its move waits for the destination and when its absence is unexplained. Test both arrival orders and a delayed withdrawal between them.
- Protect later source events, equal-time or later manual actions, and newer regional captures. Return the original result for an authorized exact replay, including after the freshness window. Reject conflicting same-time exports and new applies with future or more-than-24-hour-old captures.
- Preserve auditable history and direct access to retired frames. Keep snapshot-retired frames read-only until a verified reinstatement applies. Report blocked withdrawals, protected frames, and the reasons for rejection in job diagnostics.
- Apply admitted changes in one transaction with the job result and watermark. Keep the 5% malformed-row guard, cap retirements at 100 frames or 10% of pre-apply active frames in scope, whichever is lower, and enforce a 1-second inventory-lock wait and a 5-second apply deadline. Benchmark the existing 10,000-row limit under competing writes before enabling retirement.

## Non-Goals

- Deployed identity, operator permissions, and single-frame approval for guard-blocked withdrawals belong to the deployed authorization follow-up. [GLO-28](https://linear.app/upfrontbeats/issue/GLO-28/define-and-implement-import-authorization)
- The existing DELTA flow keeps its row-by-row import behavior and its force-overwrite recovery for manual deletion.
- Snapshot retirement preserves versions and history. Hard deletion and multi-scope jobs with independently named targets are outside the first release.
- This specification defines the contract. The implementation and rollout checks are tracked in [GLO-33](https://linear.app/upfrontbeats/issue/GLO-33/implement-scoped-snapshot-retirement-and-rollout-checks).

## Open Questions

- Confirm the v1 signature envelope and canonical payload encoding. Compact JWS is the working proposal.
- Set hard byte and event-count limits for a manifest, and select the PostgreSQL deadline mechanism before implementation.

## Critical User Journeys

### Import a confirmed withdrawal

Given 100 active frames in the app and three recorded source withdrawals, the exporter produces a signed 97-row regional capture. When an operator imports it, the app retires those three frames and links their history to the import. A truncated copy with the same manifest fails before inventory writes.

### Move a frame across regions

Given an active frame in A, A reports move 12 to B. If withdrawal 11 arrives before B, the importer records it as stale. B's valid row and matching move 12 apply one move. If B arrives first on clean data, A's later job leaves the same active version in B. Neither journey produces an intermediate RETIRED version.

### Retry after a lost response

Given a snapshot that committed and a caller allowed to view its result, the caller uploads the same signed capture after 24 hours. The importer returns the stored job and counts without creating a frame version or advancing a watermark.

## Technical Plan (Architecture)

### Producer and upload

The exporter reads one complete scope and its applicable lifecycle events from a consistent source view. Stable frame IDs and per-frame event sequences span all regions. The expected record count comes from that source view. In the local exercise, the exporter reads a fixture independent of the app's inventory.

```text
Trusted source → exporter → signed manifest and CSV → browser
Browser → signed manifest in job creation → BFF → Spring import job
Browser → signed create-only PUT → S3 → SQS → Spring dispatch → Temporal
Temporal → Spring processing → verify pinned bytes and stage rows
Spring apply → PostgreSQL → versions, event state, scope watermark, job result
Browser ← BFF ← job result, diagnostics, and frame history
```

The signed payload covers the manifest version, producer identity, canonical scope, UTC capture time, expected logical record count, SHA-256 of the exact CSV bytes, and lifecycle events. Each event carries a frame ID, stable event ID, increasing per-frame sequence, type, and effective UTC time. Move events include origin and destination, withdrawals include the last known scope, and reinstatements include the destination. Each event must be effective by capture time. Scope governs which events the producer can attest to. For a cross-scope move, an origin or destination export can contain the same event, and the destination needs the matching row to apply it. Spring verifies the signature against a trusted key authorized for the producer and scope.

The browser sends the signed manifest in the FULL_SNAPSHOT job creation request. The BFF passes the signed representation through unchanged. Spring verifies the signature and scope, binds one immutable manifest to the job, and returns the existing create-only CSV upload URL. The CSV remains the single uploaded S3 object and the existing notification triggers dispatch. Pin one accepted S3 version to the job and stream and hash that version before apply. Compare the parsed logical record count with the signed count. Keep the existing 10 MiB and 10,000-record CSV limits. A signature, schema, scope, count, or checksum mismatch fails the job before inventory writes. Store the signed-content fingerprint and original result durably so a verified repeat remains recognizable after object and row-detail retention expires.

### Scope and row validation

Use a single canonical scope per job. A scope is GLOBAL, country, country and region, or country, region and environment. Canonical membership rules apply consistently to signed scope paths, staged rows, and current frames. Validate the location fields needed for scope independently of the rest of the row so a malformed status cannot hide an invalid region.

A row that cannot be placed in the signed scope, a row outside that scope, a missing recoverable frame ID, or an unrecoverable parser error fails the job. A recoverable malformed row with verified scope contributes its ID to the presence set. Reject every row for a duplicated ID and count each rejected logical record once. Keep those IDs present for retirement checks. The 5% guard uses all logical CSV data records as its denominator and fails only above 5%. A valid header with verified expected and actual counts of zero has zero malformed records.

### Admission and replay

Verify signed evidence, the pinned CSV, and a complete staging generation before eligibility for a new apply. Under the apply lock, recheck the conditions in the order below. Returning an existing result requires permission to view it. Show a conflicting job ID only to a caller authorized to see that job.

| Condition | Decision |
| --- | --- |
| Exact committed match on signed contents and CSV checksum | Return the original result, even after expiry. Leave inventory, lifecycle records, and watermarks unchanged. |
| New apply has a future capture or is older than 24 hours | Reject. Use `SNAPSHOT_TOO_OLD` when an otherwise valid staged job ages out. Check freshness at manifest verification for new applies and again under the apply lock. |
| Different contents at the same capture time in the same scope | Reject and identify the committed conflict. A fresh capture is required. |
| A different overlapping scope has already committed at the same capture time | Reject the incoming snapshot. Report the scope, capture time, and prior job reference. |
| A newer snapshot has committed for the same scope or an ancestor | Reject the incoming snapshot as stale. |
| A newer descendant has committed | Protect that entire subtree. Skip every change touching the frame's current or proposed protected scope, including lifecycle changes and ordinary field updates. Apply eligible changes elsewhere. |
| Previous attempt failed or rolled back without committing | Evaluate the retry as a new apply. Only a committed result reserves the scope and capture time. The pinned input for the existing job remains immutable. |

At job creation, an expired manifest is eligible only for replay verification if it matches a committed result the caller can view. Verify the newly uploaded pinned CSV before returning that result. Replay verification has no path to inventory writes. Persist successful capture identities so equal-time overlaps can be checked against committed captures even after a scope advances. Advance only the incoming scope watermark on a new successful commit. A successful zero-row capture can advance it. A failed job and an exact replay leave watermarks unchanged.

### Frame lifecycle decisions

For each frame, store the newest verified source event and the last applied source event. The verified record changes only with a successful snapshot commit. Keep source event lineage separate from the fields that determine DELTA's payload hash. Evaluate the current frame, latest applicable manual action, and source events inside the apply transaction. Compare manual timestamps with the event's effective UTC time, including manual-delete history when the frame has no current version.

| Evidence and state | Decision |
| --- | --- |
| Event sequence is lower than the newest verified sequence | Skip the stale event and report it. |
| Different event claims the same sequence | Reject the snapshot before inventory writes. |
| Same event was already applied | Treat it as a no-op. |
| Origin reports a move and supplies its source evidence | Keep the frame active, record the newest verified event if eligible, and report the pending destination. The last applied event stays unchanged. |
| Destination includes the same signed move and a valid row | Append the active destination version once and advance the applied sequence. Newer verified source evidence can supersede a pending move. |
| A manual edit or deletion occurred at or after the source event | Keep the manual result, report the conflict, and leave the applied sequence unchanged. The existing DELTA force-overwrite rule for a manually deleted frame is preserved. |
| Frame is absent and the source supplies no confirmed withdrawal | Keep the frame active and report an unexplained absence. |
| Effective signed withdrawal applies to an eligible active frame in the declared scope | Add a RETIRED version with withdrawal and import job lineage. A valid live row with a withdrawal for the same frame fails the job. An identifiable malformed present row protects the frame. Report the conflicting withdrawal in the job diagnostics. |
| Snapshot-retired frame has a valid destination row and a signed reinstatement | Add an active version if the reinstatement follows the withdrawal, is effective by capture time, and passes the source and manual ordering checks. Unchanged frame details are permitted. |
| Ordinary DELTA, force overwrite, manual edit, or manual delete targets a snapshot-retired frame | Keep the retirement intact and report that the frame requires signed reinstatement. |

Treat the decision table as rules. Check scope, event ordering, and manual precedence before applying an eligible transition. A current version created or source-modified after capture is protected from withdrawal. For ordinary present rows, apply existing row conflict checks after scope and lifecycle guards. Keep malformed rows out of the version write set. Frame state and history remain readable by direct lookup and through the explicit retired filter. The default active list excludes snapshot-retired frames.

### Transaction, deadlines, and diagnostics

Stage and validate CSV and manifest evidence outside the exclusive inventory lock. Use the existing transaction-scoped inventory lock shared by manual writers and DELTA. Acquire its exclusive form for snapshot apply, and take frame locks in stable ID order. Re-read committed capture identities, lifecycle state, and frame versions inside the lock.

Before changing inventory, count eligible distinct retirements after all protections. The denominator is every pre-apply active frame in scope, including LIVE, PENDING, MAINTENANCE, BLOCKED, and DRAFT. A frame with no current version and a RETIRED version each contribute zero to that count. Fail if the eligible count exceeds 100 or if ten times the eligible count exceeds the active count. Report the candidate IDs, signed withdrawal references, eligible count, active count, and cap. Single-frame approval for blocked withdrawals belongs to the deployed authorization follow-up.

Bound each lock wait at one second and make contention retryable. Check the capture's age before each new apply. The five-second deadline starts when the exclusive lock is acquired and covers the entire apply transaction, including pre-write checks and version updates. Enforce it in the database transaction and test rollback and lock release under contention. Commit the frame versions, verified and applied event state, snapshot result, and watermark together. If the caller loses the commit response, read the durable job result before starting another write attempt.

Spring owns manifest verification, scope and lifecycle decisions, and the transaction. The Python worker orchestrates staging and apply, routes retryable lock contention, and surfaces distinct outcomes for terminal timeout and expiry. Extend the import job and worker protobuf contracts and the BFF GraphQL types for snapshot evidence and results. The frontend exposes the signed upload, snapshot results, and retired filter. Keep row diagnostics keyed to logical CSV records. Use frame- and job-level diagnostics for absent frames, protected moves, watermark conflicts, and guard failures. Deploy compatible readers and write guards before enabling retirement. A rollout switch stops new snapshot writes while committed history stays readable.

## Alternatives Considered

### Fetch the source directly

A point-in-time upstream API could give the importer a complete scope. That would couple the import to the source's API and pagination guarantees and change the browser upload flow. Alex chose a signed manifest so the producer can attest to the exact file the operator uploads.

### Match the CSV to a separate authoritative frame ID list

An authoritative ID list can prove which frames belong to a scope while preserving the legacy CSV format. The importer would also need to establish that both files reflect the same capture and to verify evidence for moves, withdrawals, and reinstatements. Alex chose one signed manifest that binds the CSV to the capture and the associated lifecycle events.

### Retire at the origin and reactivate at the destination

Applying the origin export independently this way would simplify scope removal. A frame that moved could disappear from the default inventory list until its destination export arrived, and history would show a withdrawal that never happened. Alex chose signed move evidence so the frame stays active while those exports arrive independently.

### Wait for both regional exports

The importer could hold a move until it has a matching origin and destination export. Coordinated arrival simplifies checking both sides together, but a missing or delayed export could hold up regional work. Alex chose independent imports with the same signed move evidence and a persisted distinction between verified and applied events.

### Reactivate from row presence alone

A later trusted snapshot containing the frame could reactivate it without requiring another source record. An accidental row in the export would then be enough to reopen a retired frame. Alex chose explicit reinstatement so the source supplies a dated event that explains why the frame returned.

### Apply retirement in batches

Smaller transactions would let other writers run between batches and could handle more retirements in one job. A timeout or retry could leave a partially applied snapshot and make the watermark and result harder to interpret. Alex chose one bounded transaction so accepted versions, event state, the job result, and the watermark commit together.

## Detailed Implementation Plan

### Manifest submission

Send the signed manifest in the existing job creation request and upload only the CSV to S3. Enforce the envelope size at the frontend, BFF, and Spring boundaries before expensive parsing or verification. Enforce the signed event-count limit in Spring.

### Signature envelope options

Compact JWS is the working proposal for v1. The signature algorithm, key policy, and canonical payload encoding remain open before freezing the contract.

| Option | Mechanism | Trade-off |
| --- | --- | --- |
| **Compact JWS** | Send the protected header, exact JSON payload bytes, and signature as one compact string. Verify with a configured producer key and fixed algorithm policy. | Uses a standard envelope and a single request field. Adds a JOSE dependency or equivalent library support and base64url overhead. [RFC 7515](https://www.rfc-editor.org/rfc/rfc7515.html#section-7.1) |
| **JSON bytes with a detached signature** | Send the exact UTF-8 manifest bytes as an encoded field with a separate signature and configured key identifier. | Allows platform signature primitives. The project must define and test its own envelope, encoding, and verification boundary. |

### Planned file changes

Paths are relative to the repository root. Deployment of a real producer and operator authorization remain separate rollout work.

| Path | Change |
| --- | --- |
| `src/backend/src/main/resources/db/migration/V7__add_snapshot_import_state.sql` | Create the next Flyway migration for committed capture identities, scope watermarks, verified and applied event state, retirement lineage, and frame and job diagnostics. Extend the staging shape for independent scope validation. Preserve the existing DELTA hash and historical IMPORT and MANUAL values. |
| `src/backend/src/main/java/com/global/ct/frameinventory/inventoryimport/SnapshotScope.java` | Define canonical scope paths and shared membership, ancestor, descendant, and overlap checks for manifests, rows and current versions. |
| `src/backend/src/main/java/com/global/ct/frameinventory/inventoryimport/SnapshotManifestVerifier.java` | Verify the supported envelope, trusted producer key and scope authorization, bounded payload, UTC capture, record count and event claims. Expose the verified manifest and signed-content fingerprint to job creation. |
| `src/backend/src/main/java/com/global/ct/frameinventory/inventoryimport/ImportJobService.java`, `ImportJobRepository.java` in the same package | Bind immutable snapshot evidence to the job and pin the CSV version through existing dispatch. Store the committed replay link and structured job and frame diagnostics. Enforce existing job visibility on replay and conflict references. |
| `src/backend/src/main/java/com/global/ct/frameinventory/inventoryimport/ImportGrpcService.java`, `ImportJobProblem.java`, and `ImportGrpcExceptionHandler.java` in the same package | Gate FULL_SNAPSHOT on explicit enablement, accept the chosen manifest input, validate mode-specific fields and return distinct snapshot outcomes. Reuse the local operator boundary. |
| `src/backend/src/main/java/com/global/ct/frameinventory/inventoryimport/InventoryCsvReader.java` and `ImportStaging.java` | Preserve canonical scope evidence independently of ordinary validation and keep identifiable rows in the presence set. Persist mode and evidence with a complete staging generation. Fence retries and keep the existing DELTA path. |
| `src/backend/src/main/java/com/global/ct/frameinventory/inventoryimport/ImportProcessing.java` | Route snapshot staging and apply. Stream the pinned CSV through SHA-256, compare count and checksum at completion, and retain the existing progress updates. Choose the result path for exact replay, verification failure, and restaging. |
| `src/backend/src/main/java/com/global/ct/frameinventory/inventoryimport/SnapshotApply.java` | Create the atomic apply service. Evaluate admission, protected scopes, source events, manual precedence, and retirement limits under the lock. Commit accepted versions, lifecycle state, job result, and watermark together. |
| `src/backend/src/main/resources/inventory-import/snapshot-candidates.sql` and `snapshot-insert-versions.sql` | Create set-based candidate selection and version writes for snapshot transitions. Count each distinct eligible retirement once. Lock stable IDs in order and keep presence, version changes, and provenance distinct. |
| `src/backend/src/main/java/com/global/ct/frameinventory/common/InventoryWriteLock.java` | Add exclusive apply acquisition and database-backed lock and transaction deadlines. Select the mechanism and verify cancellation, rollback, lock release, and ambiguous commit handling on PostgreSQL 18. A per-statement timeout alone does not cover the entire transaction. [PostgreSQL client timeouts](https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-TRANSACTION-TIMEOUT) |
| `src/backend/src/main/resources/inventory-import/delta-candidates.sql` | Guard snapshot-retired frames on every DELTA path, including force overwrite. Preserve the existing value projection and unchanged-row comparisons through migration. |
| `src/backend/src/main/java/com/global/ct/frameinventory/frame/FrameRepository.java`, `FrameService.java`, `FrameProblem.java`, `FrameProtoMapper.java`, `FrameGrpcExceptionHandler.java`, and `FrameGrpcService.java` in the same package | Add retired filtering and audit lineage to supported reads. Reject ordinary edits and deletes against snapshot-retired frames after locking and checking the current version. |
| `src/backend/src/main/proto/frameinventory/v1/inventory_import.proto` and `frames.proto` | Add a snapshot-only signed manifest field to job creation, replay and diagnostic results, explicit retired filtering and retirement lineage. Keep existing DELTA fields compatible. |
| `src/backend/src/main/proto/frameinventory/v1/import_worker.proto` and `src/backend/src/main/java/com/global/ct/frameinventory/inventoryimport/ImportWorkerGrpcService.java` | Expose enough apply outcome information to distinguish completion or replay, stale staging, retryable contention, and a terminal failure. Keep row progress. |
| `src/workflows/inventory_workflows/workflow.py` and `activities.py` | Orchestrate the distinct worker outcomes. Retry contention while eligible and surface expiry and apply timeout. Keep workflow replay compatibility for existing DELTA histories. |
| `src/backend/src/main/java/com/global/ct/frameinventory/inventoryimport/ImportMetrics.java`, `ImportJobMaintenance.java`, and `monitoring/dashboards/frame-inventory-imports.json` | Track lock wait and hold duration, guard failures, verification failures, and replay outcomes with bounded labels. Expire detailed diagnostics on the existing retention schedule and keep durable replay and lineage summaries. |
| `src/backend/src/main/resources/application-local-import.yml` and `docker-compose.yml` | Configure developer enablement and trusted fixture producer keys without checking in private signing keys. Keep snapshot writes disabled by default and support switching them off while retaining compatible readers. |
| `src/bff/schema/inventory-import.gql`, `query.gql`, and `frames.gql` in the same directory | Expose snapshot inputs, results, diagnostics, retired filter, and lifecycle provenance. Keep generated contracts backward compatible. |
| `src/bff/src/resolvers/inventory-import.ts`, `frames.ts` in the same directory, `src/bff/src/inventory-import-client.ts`, and `src/bff/src/frame-client.ts` | Add translations for the new protobuf types and outcomes, keep GraphQL permissions for result lookup, and enforce the manifest input limit and forward the signed representation unchanged. |
| `src/frontend/src/app/inventory-import.graphql`, `inventory-import.tsx`, `inventory-list.graphql`, and `inventory-list.tsx` in the same directory | Add the snapshot upload controls and scope summary, clearly distinguish already-applied jobs and guard failures, and expose the explicit retired filter. |
| `src/frontend/src/app/frame-detail.graphql`, `frame-detail.tsx`, `frame-history.graphql`, and `frame-history.tsx` in the same directory | Display event and import lineage and keep snapshot-retired frames read-only. Regenerate `src/frontend/src/generated/graphql.ts` from the updated contract. |
| `infra/inventory-import/local/export_snapshot.py` and `data/snapshot-cases/README.md` | Create a local signed-export tool backed by source fixtures independent from app inventory. Document a complete capture, two-order move, delayed withdrawal, empty capture, and retirement guard examples. |
| `src/backend/README.md`, `src/workflows/README.md`, `src/frontend/README.md`, `src/frontend/src/app/README.md`, `infra/inventory-import/README.md`, and `docs/designs/frame-inventory-schema.md` | Describe local signing and upload, worker outcomes, audit and diagnostics, scoped lifecycle state, and how to disable new snapshot writes while keeping existing history readable. |
| `src/backend/src/test/java/com/global/ct/frameinventory/inventoryimport/SnapshotManifestTests.java`, `SnapshotApplyTests.java`, and `ImportGrpcTests.java` in the same package | Cover trusted envelope validation, admission and lifecycle ordering, snapshots and concurrent writes in PostgreSQL, and the job and diagnostic RPCs. |
| `src/backend/src/test/java/com/global/ct/frameinventory/inventoryimport/ImportDeltaApplyTests.java` and `src/backend/src/test/java/com/global/ct/frameinventory/frame/FrameGrpcTests.java` | Add regression cases for unchanged DELTA after migration, retired reads, blocked DELTA force and manual writes, and manual deletion recovery. |
| `src/bff/test/inventory-import.test.ts`, `src/bff/test/frames.test.ts`, and `src/frontend/src/app/inventory-import.test.ts` | Cover manifest upload input, replay and diagnostic presentation, and retired filtering and history through existing API paths. |

### Verification Plan

Run backend tests with `./gradlew test` from `src/backend`. Run BFF tests with `npm test` from `src/bff` and frontend tests, lint, and build from `src/frontend`. Use the main Compose stack and the controlled exporter for the browser checks. Assert job outcome, current frame state, version history and watermark in the snapshot integration cases.

| Scenario | Expected result |
| --- | --- |
| 100 current frames, verified 97-row capture and three signed withdrawals | Exactly three RETIRED versions, linked to withdrawals and job. One scope watermark advances. The truncated copy, digest mismatch, or count mismatch fails before writes. An unauthorized key or invalid signature fails before issuing the CSV upload URL. |
| A verifies move 12, delayed withdrawal 11 arrives, then B applies matching move 12 | Withdrawal 11 is skipped. One active version in B follows the origin version, with no intermediate retirement. Repeat with B first and with an origin transaction that rolls back. |
| A withdrawal takes effect at 09:00, the app records a manual edit or delete at 09:30, and the capture is at 10:00 | The manual action wins. History, current version, and last applied event are preserved. Run the exact-time tie and a newer eligible source event. |
| An older country import follows a newer regional import | Changes touching the newer region through current or proposed scope are skipped. Eligible changes elsewhere can commit. A same-time overlapping capture fails atomically. |
| The original apply committed and its response was lost | Exact authorized replay returns the stored result, including after 24 hours. An expired manifest matching a visible committed result is eligible only for replay verification. A different CSV fails verification. New expired, future, or conflicting equal-time apply attempts fail before writes. |
| Invalid required scope, recoverable malformed present row, duplicate IDs, and signed zero rows | Scope errors fail the job. Recoverable present IDs protect their frames and count at most once per row toward the malformed guard. A signed empty capture follows normal admission and caps. |
| Malformed percentage and retirement limits at their boundaries | Verify exact 5%, 10%, and 100 retirements, then the first values exceeding each. A scope with nine active frames and one withdrawal fails and reports the candidate, evidence and cap. |
| Retired frame and later valid reinstatement with identical attributes | Default listing hides the retired frame, and explicit access retains history. Manual edit, manual delete, DELTA and forced DELTA leave retirement intact. The reinstatement creates one active version. |
| Exclusive lock already held, apply exceeds deadline, or worker loses commit acknowledgement | Distinguish retryable contention, full rollback on deadline, and committed result recovery. Inventory and watermarks remain consistent with the durable job outcome. |
| 10,000-row import under competing DELTA and manual writes | Measure lock wait, lock hold, and write delay before enabling retirement. Confirm the 1-second acquisition and 5-second apply behavior against PostgreSQL, including rollback and release. |

*Drafted with EGM*

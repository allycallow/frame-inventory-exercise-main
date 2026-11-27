# Bulk CSV inventory import

- **Author** — Alex Callow
- **Status** — Proposed
- **Date** — 2026-11-26

## Overview

Inventory operators can upload `inventory_frame.csv` from the running application and see the result as the job progresses. A routine update changes only the frames named in the file. An authoritative snapshot can also retire missing frames within a declared area of the inventory. Every accepted change is visible in frame history.

## The Problem

The application supports individual frame edits, but operators receive inventory updates as CSV files. Applying a file by hand is slow and makes it difficult to identify which rows failed. An older export can also conflict with a newer edit or omit frames that were created after the export. Operators need to apply the file, see what was accepted or skipped, and understand why a frame changed.

## Goals

- Let an authorized operator upload the supplied 45-field CSV from the application and see job progress, final counts, and actionable row errors.
- Apply `DELTA` by default. Leave absent frames alone, preserve newer edits unless the operator explicitly forces a conflicting change, and avoid duplicate frame versions on retry or re-upload of unchanged rows.
- Support `FULL_SNAPSHOT` for a single declared scope. Require country and region for environment-level scopes. Protect frames present in malformed rows, frames changed after the export watermark, and partitions with newer snapshots. Prevent retirement when the malformed-row rate exceeds 5% and abort before inventory writes if more than 10% of scoped active frames would retire.
- Preserve accepted versions, source timestamps, and import lineage so operators can trace updates, forced corrections, and retirements.

## Non-Goals

- Hard deletion of inventory during import.
- Arbitrary CSV schemas, field mapping, or automatic repair of malformed values.
- A single snapshot covering several separately named scopes in the first release. Operators can submit separate regional snapshots or use `DELTA` for a cross-region update.

## Technical Plan (Architecture)

### Upload and dispatch

```text
Operator → web app → BFF → Spring Boot → import_jobs
Operator → presigned PUT → S3 → SQS standard queue → Spring Boot → Temporal
                                   SQS retries → DLQ → dispatch reconciler
Temporal worker → pinned S3 object → PostgreSQL staging → inventory apply
Inventory apply → frame versions + job outcome
Operator ← web app ← BFF ← Spring Boot job status and row errors
```

The job creation API takes the import mode, optional snapshot scope and export watermark, and explicit force flag. Spring Boot validates the requested scope and permissions, creates an AWAITING_UPLOAD job, and returns its ID and the presigned PUT details through the BFF. The upload key is uploads/{jobId}/inventory_frame.csv. Use a create-only PUT and persist the accepted S3 object version so all retries read the same bytes. Expose job status, counts, fatal errors, and paginated row errors through the BFF.

Configure S3 to send object-created notifications for the uploads/ prefix directly to a standard SQS queue in the same AWS Region. Grant the bucket permission to publish through a queue policy scoped to the bucket ARN and owner account. The Spring Boot consumer handles the native S3 notification envelope, recognizes the S3 test event, and processes each object record. It decodes the key and verifies the bucket, key, object version, and size, then conditionally records PENDING and starts Temporal workflow csv-import-{jobId}. Duplicate or out-of-order records must preserve the existing object binding and job state. Acknowledge the message after each applicable record has been handled, including confirming successful or already-completed workflow dispatch. If processing a later record fails, replay of earlier records uses the same job and workflow identities. Retry with backoff. Before a DLQ event can fail a job, reconcile ambiguous workflow starts and check that the job is still dispatchable. Reconcile old AWAITING_UPLOAD and PENDING jobs against S3 and Temporal.

### Staging and validation

Accept files up to 10 MiB and 10,000 data rows, whichever limit is reached first. Verify object size before dispatch and enforce both limits while streaming. The header does not count. Exceeding either limit fails the job before inventory writes. Keep uploaded object versions and row diagnostics for 7 days. Keep the minimal durable job outcome and import lineage available to history after diagnostics expire. Bound retries and reconciliation within the object retention period.

Interpret the CSV created_date and modified_date fields as UTC at their supplied precision. Use UTC for source_modified_at storage and explicitly interpret the existing offset-free PostgreSQL column as UTC regardless of the database session timezone. Convert source timestamps to instants for watermark and manual-edit comparisons.

The Temporal worker reads the pinned object and streams logical CSV records into job- and attempt-scoped UNLOGGED staging. Heartbeats report progress and let the worker detect cancellation. Keep the EOF completion marker in the same unlogged storage as the data. Before apply, check the marker and staged counts. If a crash leaves staging incomplete or empty, reload from S3. Store row errors with stable job, row, and error keys for retries. Track identifiable frame IDs independently of row validity. Hash canonical typed frame values with SHA-256 over a versioned, ordered encoding. Preserve meaningful text, normalize typed numeric values by value, encode null distinctly, order external references by type, and preserve the position of links. Exclude job metadata, version validity, and source timestamps from the payload hash. Compare hashes using the same encoding version. After staging, reject every row for a frame ID that appears more than once, report DUPLICATE_FRAME_ID for each duplicate row, and keep the ID in the snapshot presence set. Count each rejected logical record once toward the malformed-row threshold, even if it has several validation errors.

### Inventory and history

Use the existing frame table for stable identity and frame_version for current and historical values. Resolve region, town, postcode, and format through existing lookup tables. Attach external references and ordered links to the resulting frame version. Add job, row error, scope watermark, and import lineage storage through Flyway. Map the complete CSV to the existing model, including site and spec fields on frame_version. The BFF, protobuf service definitions, Spring service, and worker need changes for job creation, progress, and application.

Re-read the current version under the existing stable-frame lock. A newer source timestamp creates a version. Equal timestamp and hash is a no-op. Skip and report stale rows and same-timestamp collisions unless forceOverwrite is authorized and set, and record both hashes for collisions. Manual writes set source_modified_at from database statement time after locking, and CSV writes preserve the input timestamp. For existing manual versions that inherited their source timestamp, use the version’s valid_from as the effective conflict baseline. Identify those versions at migration time and preserve the original source_modified_at for history. Forced corrections record FORCED_OVERWRITE and import_job_id. Subsequent imports compare against the current version’s source timestamp, including when a forced overwrite moves that timestamp backward. For example, an 11:00 row is newer after a forced overwrite replaces a 12:00 version with a 10:00 version. Use the same database-generated boundary for closing and opening a version, strictly later than the previous valid_from.

When a frame has no current version and its latest version was closed by MANUAL_DELETE, require an authorized forceOverwrite to restore it in either import mode. Without that flag, skip the row and record MANUALLY_DELETED in the job’s row errors. With it, append a new current version, preserve the CSV source timestamp, and record FORCED_OVERWRITE and import_job_id in the apply transaction. Compare and restore under the stable-frame lock.

Promote a complete staging attempt in one transaction. Acquire the job lock and verify eligibility before writing. Use one source candidate per target key and MERGE RETURNING where it fits. Close current versions and append replacements in separate set-based statements. Commit inventory, versioned references and links, the applicable scope watermark, and job result together. If the worker loses the commit response, return the stored result when it retries.

### Snapshot apply

The [FULL_SNAPSHOT safety contract](full-snapshot-import-design.md) records the
reviewed backlog draft for scoped retirement. This section describes the original proposal.

Keep staging outside the inventory lock. During promotion, take a shared transaction-scoped inventory lock for manual writes and DELTA and an exclusive lock for FULL_SNAPSHOT. Obtain frame locks in stable ID order. Evaluate scope membership, watermark checks, and retirement against the protected pre-apply view.

Require scope to be GLOBAL or a canonical country, country/region, or country/region/environment path. Use the explicit snapshot_as_of where available, otherwise derive it from MAX(modified_date) on the complete file. Check freshness and reject watermarks below the greatest committed value for the scope or its ancestors. A broader snapshot can still apply its present rows under the ordinary conflict rules when a descendant has a newer watermark. Protect that entire descendant subtree from retirement.

Before writing inventory, fail the entire snapshot for a header-only file, an incomplete export, or an unrecoverable CSV parse error. Also fail the snapshot if any row has no recoverable frame ID or any record is outside the declared scope. Keep job diagnostics and leave inventory and the scope watermark unchanged. Count any identifiable frame ID in the CSV as present, including when other fields are malformed. Among absent active frames, exclude protected child scopes and current versions whose valid_from or source_modified_at exceeds the export watermark. Record SKIPPED_RETIREMENT_NEWER_THAN_SNAPSHOT for the latter. If eligible retirements exceed 10% of all active frames in the declared scope, fail before inventory writes. If more than 5% of CSV rows are malformed, fail the entire snapshot before writing inventory. Keep the job diagnostics and leave the scope watermark unadvanced. Represent each accepted retirement with a new RETIRED version and MISSING_FROM_FULL_SNAPSHOT. Advance only the incoming scope watermark on a successful commit.

Exclude snapshot-retired frames from the default inventory list. Expose them through an explicit retired filter, direct lookup, and frame history.

A FULL_SNAPSHOT can reactivate an unchanged row when the current version was retired with MISSING_FROM_FULL_SNAPSHOT, the incoming export watermark is strictly later than that retirement version’s valid_from, and the row’s source timestamp and canonical payload hash match the last live version. Append a new live version in the apply transaction. Apply normal conflict rules to other rows and to DELTA imports.

## Alternatives Considered

### Forward S3 notifications through Lambda

A Lambda bridge can normalize events or route them to several destinations. The import has a single queue, and Spring Boot can consume the native event. The bridge adds a deployment and another delivery failure path.

**Rejected by author** — Send S3 notifications directly to the standard SQS queue to remove the forwarding hop.

### Use logged staging

Logged staging can survive a PostgreSQL restart or failover and avoids downloading and parsing the same object again after staging is lost. It adds write-ahead logging and storage work for intermediate rows. The initial design uses UNLOGGED staging with replay from the pinned S3 object. Measure the cost of both approaches at the maximum supported upload size before committing to larger files.

### Migrate to the six-table inventory model and separate frame history

Separate site and spec entities would give those concepts independent identities and lifecycles. A migration would also change existing inventory reads and writes and would need to preserve historical values when site or spec records change.

**Rejected by author** — Extend the existing versioned schema for this release. It already gives current and historical frames one authoritative store and preserves links and external references per version. A separate history store would add a second representation of those changes.

## Detailed Implementation Plan

Deliver the operator-facing DELTA path first. Enable FULL_SNAPSHOT after measuring transaction duration and verifying retirement safeguards against the supplied CSV and concurrent writers.

1. Add the import storage and schema invariants.

   - Create [V3__create_inventory_import.sql](../../src/backend/src/main/resources/db/migration/V3__create_inventory_import.sql) for import_jobs, import_row_errors, staging rows and completion markers, scope watermarks, and import provenance on frame versions. Enforce one accepted object version per job, valid scope shape, and stable row error keys. Keep staging rows and their completion marker unlogged, with indexes for job/attempt and presence checks. Keep the durable job result separate.
   - Update [frame-inventory-schema.md](frame-inventory-schema.md) to document source timestamps, interval boundaries, collision handling, retirement, and force-only restoration after manual deletion.

2. Add the backend job and worker entry points.

   Backend Java paths below are relative to [src/backend/src/main/java/com/global/ct/frameinventory](../../src/backend/src/main/java/com/global/ct/frameinventory).

   - Modify [build.gradle](../../src/backend/build.gradle) for the AWS, Temporal, and CSV parsing dependencies. Modify [application.yml](../../src/backend/src/main/resources/application.yml) to configure bucket, queue, DLQ, Temporal namespace and task queue, retry and upload settings, and worker enablement.
   - Create [inventory_import.proto](../../src/backend/src/main/proto/frameinventory/v1/inventory_import.proto) for the creation request, required signed PUT headers, status and counts, and paginated row errors. Add inventory import messages and RPCs without changing existing frame RPCs.
   - Create `inventoryimport/ImportGrpcService.java` to validate RPC requests, pass operator identity to the job service, and return job status and row diagnostics. Create `inventoryimport/ImportJobService.java` to authorize the requested mode and force flag, validate canonical scope, create the job, and sign the exact S3 PUT. Create `inventoryimport/ImportJobRepository.java` for conditional job transitions, object binding, diagnostics, and returned outcomes.
   - Create `inventoryimport/ImportDispatch.java` to decode the S3 envelope, handle test events, reconcile stale jobs, start Temporal idempotently, and handle DLQ outcomes without regressing running or completed jobs. Keep queue acknowledgment at the message boundary.
   - Run the workflow and activities in the [Python Temporal worker](../../src/workflows/README.md). Keep SQS dispatch and inventory processing in Spring. The worker calls `ImportWorker` over loopback for staging, apply, and terminal failure updates.
   - Create `inventoryimport/InventoryCsvReader.java` to parse CSV logical records, recover IDs where possible, validate typed fields, and build canonical hashes. Create `inventoryimport/ImportStagingRepository.java` to write batches, fence loader attempts, and publish and validate the completion marker. Keep row error persistence idempotent across restaging.
   - Create `inventoryimport/ImportApplyRepository.java` for the set-based transaction and eligibility checks. Reserve stable IDs, lock them in order, and re-read current versions before evaluating the timestamp/hash rules. Resolve existing dimensions, close and append versions, copy or replace versioned children as appropriate, and persist the final job outcome with the inventory changes. Measure guards before mutation, including scope completeness, empty snapshots, malformed percentage, watermark checks, and retirement percentage.
   - Modify `frame/FrameRepository.java` and `frame/FrameService.java` to coordinate manual writes with the shared inventory lock and set manual source timestamps after locking. Keep the current close/open interval invariant, and verify manual deletion history and restoration through imports. Implement default retirement filtering in list queries and add the retired filter to [frames.proto](../../src/backend/src/main/proto/frameinventory/v1/frames.proto), `frame/FrameGrpcService.java`, [frames.gql](../../src/bff/schema/frames.gql), [frames.ts](../../src/bff/src/resolvers/frames.ts), [frame-client.ts](../../src/bff/src/frame-client.ts), and the inventory list in [page.tsx](../../src/frontend/src/app/page.tsx). Preserve direct and history lookups.

3. Wire the application through the BFF and frontend.

   - Create [inventory-import.gql](../../src/bff/schema/inventory-import.gql) for job creation, status, and row-error types. Update [query.gql](../../src/bff/schema/query.gql) and [codegen.yml](../../src/bff/codegen.yml) where needed to expose the new operations and generated types.
   - Create [inventory-import-client.ts](../../src/bff/src/inventory-import-client.ts) for the import RPC client and [inventory-import.ts](../../src/bff/src/resolvers/inventory-import.ts) for GraphQL resolvers. Update [server.ts](../../src/bff/src/server.ts) and [index.ts](../../src/bff/src/index.ts) for schema, resolver, and client wiring. Preserve request correlation and authorization context.
   - Modify [page.tsx](../../src/frontend/src/app/page.tsx) to expose the upload entry point. Create [inventory-import.tsx](../../src/frontend/src/app/inventory-import.tsx) to collect mode and scope, submit the presigned PUT with its required headers, poll the job, and show progress and errors. Update [globals.css](../../src/frontend/src/app/globals.css) for the upload and results UI.

4. Provision and document deployment.

   - Create `infra/inventory-import/versions.tf` for Terraform and AWS provider requirements, `infra/inventory-import/variables.tf` for environment inputs, `infra/inventory-import/main.tf` to provision same-region S3 and SQS, a DLQ and redrive policy, queue publish policy scoped to the source bucket and account, and the IAM policies for signing, reading the accepted object, and consuming the queues. Create `infra/inventory-import/outputs.tf` for the bucket name, queue URLs, and application policy ARN. Commit the generated `infra/inventory-import/.terraform.lock.hcl` to pin provider selection. Use `infra/inventory-import/README.md` to document environment-specific remote state and locking, provisioning order, and Spring Boot configuration from those outputs. Enable bucket versioning and configure the seven-day upload lifecycle, including noncurrent versions. Add diagnostic cleanup to the existing import job reconciliation schedule. Preserve job summaries and lineage when deleting row diagnostics. Configure S3 CORS for the frontend origin and the signed PUT headers. Document the deployed resources, local test path, and failover/reconciliation procedure in [src/backend/README.md](../../src/backend/README.md) and the operator flow in [README.md](../../README.md).
   - Start local Temporal and the S3/SQS emulator in [docker-compose.yml](../../docker-compose.yml). The `infra/inventory-import/local/init-aws.sh` hook creates the versioned test bucket, standard queue, DLQ, and bucket notification. Compose gives Spring internal emulator endpoints and a browser-reachable signing endpoint. [LocalStack S3-to-SQS setup](https://docs.localstack.cloud/aws/tutorials/iam-policy-stream/)
   - Instrument queue age, job age, restaging, validation outcomes, and safety guards without high-cardinality metric labels.

5. Verify behavior through the normal entry points.

   - Create backend tests under `src/backend/src/test/java/com/global/ct/frameinventory/inventoryimport/`. Use `InventoryCsvReaderTests.java` for the supplied CSV, multiline fields, empty files, missing IDs, duplicate IDs, exact byte and logical-row limits, hash stability, and UTC timestamp parsing under non-UTC JVM and database session settings. Use `ImportDispatchTests.java` for native envelopes, test events, duplicates, delayed delivery, and ambiguous starts followed by DLQ. Use `ImportApplyTests.java` with PostgreSQL 18 for the full apply transaction, idempotent retries, legacy and manual edits, force restoration, reactivation, and rollback without inventory or watermark changes. Exercise stale, equal, enclosing, and descendant watermarks, the exact 5% and 10% boundaries, concurrent manual writes, incomplete staging, and activity retry after commit.
   - Create [inventory-import.test.ts](../../src/bff/test/inventory-import.test.ts) for create/status/error RPC wiring and identity propagation. Run the existing backend and BFF suites and type checking. Run an end-to-end upload through the application against the Compose stack and check final counts, persisted history, recovery from duplicate notifications without a second apply, and retention cleanup that preserves job summaries and frame history. Repeat a smoke test in a Terraform-provisioned AWS sandbox to verify IAM, browser CORS, signed create-only PUT, S3 version binding and notification delivery, and SQS redrive on the real services.

## Release and review follow-up

- GLO-36 tracks the DELTA release check. Upload the supplied CSV twice through the browser and verify 1,000 applied, then 1,000 unchanged, with 1,000 frame versions total. Check diagnostics and history links. [GLO-36](https://linear.app/upfrontbeats/issue/GLO-36/verify-and-release-the-delta-import-flow)
- The test operator is local-only. A deployed import needs a verified operator identity and permissions across the BFF and Spring Boot. [GLO-28](https://linear.app/upfrontbeats/issue/GLO-28/define-and-implement-import-authorization)
- Keep snapshot retirement disabled until the producer can attest completeness for the declared scope and uploaded bytes. GLO-34 also covers scope moves, watermark ordering and reactivation, and limits on retirement work under the inventory lock. [GLO-34](https://linear.app/upfrontbeats/issue/GLO-34/define-the-full-snapshot-safety-contract)

[Source RFC](bulk-csv-inventory-import.md)

*Drafted with EGM*

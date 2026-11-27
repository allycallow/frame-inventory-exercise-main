# Bulk CSV inventory import

Author: Alex Callow
Date: 2026-11-26

> Historical RFC. See the [proposed design](bulk-csv-inventory-import-design.md) for the decisions made during drafting and the remaining release work.

## Overview

An inventory operator uploads inventory_frame.csv directly to S3 using a presigned URL. The BFF delegates job creation to Spring Boot, which records AWAITING_UPLOAD and assigns uploads/{jobId}/inventory_frame.csv. An S3-triggered Lambda sends the upload event to SQS. Spring Boot moves the job to PENDING and starts Temporal workflow csv-import-{jobId}. SQS retries failed delivery and a DLQ listener records dispatch failures.

The worker streams the CSV into job-scoped UNLOGGED PostgreSQL staging in batches and heartbeats during loading. It records invalid rows in import_row_errors and applies set-based writes with MERGE RETURNING where appropriate. The proposed six-table target and frame history must be reconciled with the repository's existing versioned schema. Inventory changes and outbox records must commit together.

## Agreed import behavior

- A newer source timestamp creates a version. An equal timestamp and matching content hash is a no-op. An older timestamp produces STALE_RECORD. An equal timestamp with different content produces TIMESTAMP_COLLISION_CONFLICT and records both hashes. Skipped conflicts result in COMPLETED_WITH_ERRORS.
- The explicit forceOverwrite flag accepts stale and same-timestamp conflicts. The new version preserves source_modified_date and records FORCED_OVERWRITE and import_job_id. Close and open at one database-generated boundary strictly later than the locked current valid_from.
- DELTA is the default and leaves absent frames alone. FULL_SNAPSHOT requires an explicit GLOBAL scope or validated partition scope using country, region or environment. Every identifiable frame ID in the file counts as present, including rows with invalid payloads.
- FULL_SNAPSHOT soft-retires absent active frames in scope with MISSING_FROM_FULL_SNAPSHOT. Abort if more than 10% of scoped active frames would retire. A malformed-row rate above 5% must prevent retirement. Whether to fail the whole snapshot is open.

## Analysis

All seven Goldfish lenses completed review. The recommendations below are proposed decisions for RFC alignment.

### Delivery and recovery

- Bind each job to one immutable object. Sign the exact key and the create-only PUT condition (If-None-Match: *), enable S3 versioning, and persist the accepted version ID so every retry reads the same bytes. Keep the object through the retry and reconciliation window. Validate the bucket, decoded key, object version, and size before dispatch. [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) [S3 event delivery](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html)
- Record PENDING conditionally, invoke Temporal with the job-derived workflow ID, and acknowledge SQS only after start or after confirming the same job's workflow already exists. Configure both running-ID conflict and closed-ID reuse policies. A crash between the DB write and Temporal start leaves a retryable PENDING job. A lost start response must be reconciled before any DLQ transition to FAILED. Guard terminal states and fence a late starter with conditional job transitions before it can apply inventory. Reconcile old AWAITING_UPLOAD and PENDING jobs against S3 and Temporal, and cover Lambda delivery failures separately from consumer DLQ failures. [Temporal workflow ID policies](https://docs.temporal.io/develop/java/nexus/development-walkthrough/send-messages)
- Stage by job ID, attempt generation, and logical CSV row number. Record observed frame IDs independently of row validity. Mark a generation complete only after EOF and verify that its completion marker and counts still match before applying. Keep the marker in unlogged storage with the staged rows so recovery clears both, and reload from the bound S3 version when the marker is missing. Use heartbeats for liveness and cancellation. Restart the stream for an incomplete generation in the first release. Record row errors durably with stable keys so retries do not duplicate errors. [PostgreSQL unlogged tables](https://www.postgresql.org/docs/18/sql-createtable.html)

### Inventory apply

- Reuse the existing stable-frame lock, current-version uniqueness constraint, and close-and-append history. The repository already computes a boundary as the greater of database wall-clock time and the current valid_from plus one microsecond, then uses that boundary for the next version. Reuse this rule for all imported changes, including retirements. Preserve source_modified_at separately. The existing schema already stores versioned external references and links. Map each of the 45 CSV fields before adding new tables or moving attributes. Keep immutable history when normalizing shared site or spec data. [Schema](frame-inventory-schema.md) [Repository](../../src/backend/src/main/java/com/global/ct/frameinventory/frame/FrameRepository.java)
- Define the content hash over canonical typed values, including versioned links and external references. Specify normalization, timezone and precision, null behavior, and duplicate-ID handling. Change manual UI/API writes to set source_modified_at from statement_timestamp() on the version insert after obtaining the frame lock. Preserve the source timestamp on CSV imports, including forced overwrites. Define how comparisons handle legacy manual versions that inherited an older source timestamp. A forced overwrite can move the current source timestamp backward. A separate source high-water mark remains an open decision.
- Build one candidate per target key before set-based writes. Resolve shared dimensions and reserve frame identities before opening dependent versions and links. PostgreSQL 18 supports MERGE RETURNING, but a source candidate takes only one action, so close and append in separate set-based statements in the same transaction. Use the actual changed version IDs to produce outbox records. Commit versions, links, outbox, and final job status together. A retry after a lost commit response returns the committed result. [PostgreSQL MERGE](https://www.postgresql.org/docs/18/sql-merge.html)
- Compute the retirement numerator and denominator on the same protected pre-apply inventory view. Row locks protect existing IDs, while new frames and edits that move into or out of scope require a shared writer protocol. Start with a transaction-scoped inventory lock held in shared mode by manual writes and DELTA applies, and in exclusive mode by snapshots. Take per-frame locks in stable ID order. This serializes promotion of snapshots even when their scopes are disjoint. Keep it out of upload, parsing, and staging. Measure lock time before enabling the feature. Never infer absence from a partial stream or an unrecoverable CSV parse error. Decide whether unidentifiable rows, scope violations, and header-only snapshots fail the whole job. The proposed default is to fail a snapshot before any inventory write when a safety check fails.

### Snapshot watermark

- Persist snapshot_as_of on the job. Accept a producer-supplied export watermark at job creation. When omitted, derive it from MAX(modified_date) after scanning the complete file. Use one documented source timezone and precision for comparisons. Require the exporter to supply an explicit watermark when the file cannot establish one. MAX(modified_date) measures the newest row change and can lag the time a complete export was generated. It also cannot prove completeness, so prefer the explicit export watermark for feeds where these times differ.
- Use canonical scope keys in a containment hierarchy: GLOBAL, country, country/region, and country/region/environment. Require a region for every environment-level FULL_SNAPSHOT in the first release. Reject a country/environment scope such as UK/UNDERGROUND at job creation. An operator can export a separate authoritative snapshot for each region or use DELTA for a cross-region file.
- Before inventory writes and under the snapshot apply lock, reject a watermark outside the freshness window (proposed default 24 hours), in the future beyond allowed clock skew, or strictly below the maximum committed watermark for the requested scope and its ancestors. Equal watermarks pass this check. On successful commit, advance only the requested scope's watermark, including when the job completes with row errors. A failed job leaves all watermarks as they were.
- A newer descendant watermark does not reject an enclosing snapshot. Apply normal row conflict checks throughout the requested scope, including newer child scopes. Before retiring absent frames, exclude the entire subtree of each descendant whose committed watermark is strictly newer than the incoming watermark. Report the protected scopes and skipped retirement count. A descendant at the same watermark remains eligible. For example, a GLOBAL export at 11:30 can apply after a partition snapshot at 12:00, with retirement excluded in that partition. A partition export at 11:00 fails if an ancestor already committed at 12:00.
- Among the remaining absent active frames, exclude any whose current valid_from or source_modified_at is after snapshot_as_of and record SKIPPED_RETIREMENT_NEWER_THAN_SNAPSHOT. This protects newer current versions, including edits within the same scope. Count only eligible retirements in the 10% numerator and keep the denominator as all pre-apply active frames in the declared scope. Capture the watermark checks, both exclusion counts, the breaker calculation, and the scope watermark update in the same protected apply transaction.

### Snapshot history and reactivation

The agreed representation is a new current version with status RETIRED and reason MISSING_FROM_FULL_SNAPSHOT. Define how current inventory queries treat that version and how a later import reactivates it. Existing manual deletion closes the last current version without opening a replacement. Keep those behaviors explicit in the status and history contract. If snapshot closure sets closed_by_change_source, extend the V2 constraint, which currently allows only MANUAL_DELETE. [V2 migration](../../src/backend/src/main/resources/db/migration/V2__add_frame_change_source.sql)

## Goals and non-goals

- Deliver authenticated upload, visible job progress and row errors, retry-safe imports, audited versions, scoped retirement, and transactional outbox records.
- Leave mass deletion, generalized CSV mapping, automatic repair of malformed source values, and multi-scope FULL_SNAPSHOT uploads outside the first release. If authoritative cross-region exports become a regular need, consider one atomic job over explicitly named scopes, each with its own watermark and retirement check.

## Alternatives weighed

- Keep the S3-to-Lambda bridge as requested. Direct S3-to-SQS delivery could remove an operational failure path if the bridge only forwards events. Verify what routing or event normalization the Lambda needs to own.
- Keep UNLOGGED staging with full source replay for initial implementation. Durable staging could reduce replay cost and operational complexity after failover, at the cost of logging intermediate data. Benchmark with the expected maximum file.
- Reuse versioned history as the initial design direction. Add a separate frame_history table only if it serves a distinct audited need. Otherwise two history stores would require agreement on which is authoritative.

## Key decisions and implementation sequence

1. Map the CSV to the current schema and the proposed six entities. Resolve source timestamp parsing, manual-edit ordering, force authorization, link semantics, duplicate IDs, and schema ownership before migrations.
2. Add durable job, row error, lineage, and outbox storage through additive Flyway migrations. Expose BFF job creation and status, including counts, fatal errors, and paginated row errors. Set upload-size, row-count, timeout, and retention limits from the agreed operating envelope.
3. Implement the S3 event bridge, SQS dispatch and DLQ, and Temporal start. Exercise duplicate notifications, late events, ambiguous starts, and reconciliation before applying inventory.
4. Implement staging and atomic DELTA apply. Run the supplied CSV against PostgreSQL 18 and check replay, timestamp collisions, manual edits, forced overwrite, malformed quoting, duplicate IDs, lost staging, and worker failure immediately after commit.
5. Add scoped FULL_SNAPSHOT with a protected retirement calculation. Verify that malformed rows with IDs stay present, out-of-scope frames stay untouched, and the exact 5% and 10% boundaries behave as agreed. Exercise rejection of environment scopes without a region, expired and out-of-order watermarks, watermark equality, derived watermarks, newer ancestors rejecting narrower snapshots, newer descendants protecting entire subtrees while present rows still upsert, frames created or moved into scope after export, and concurrent manual writes. Roll out DELTA first, then enable snapshot after observing apply times and reviewing operator safeguards.
6. Track queue age and DLQ depth, time in each job state, staging retries, apply transaction duration, row error codes, retirement guard trips, and outbox lag. Correlate logs by job ID and keep presigned URLs and raw row content out of logs.

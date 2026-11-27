# Backend

## Overview

The backend is a Java 21 Spring Boot application. Spring gRPC serves frame management on port 9090. Spring MVC and Actuator serve health endpoints on port 8080. Spring Boot applies Flyway migrations against PostgreSQL at startup. The Docker image builds a Spring Boot JAR and runs it on Java 21. [build.gradle:languageVersion] [build.gradle:dependencies] [Dockerfile:RUN] [Dockerfile:ENTRYPOINT]

## Subdirectories & Boundaries

- [Source tree](./src/README.md) contains the application and its runtime configuration.
- [Inventory migration](./src/main/resources/db/migration/V1__create_frame_inventory.sql) creates the frame, version history, and related tables.
- [Frame inventory schema](../../docs/designs/frame-inventory-schema.md) maps the CSV fields and describes the shared Spring write transaction.

## Local development

Start the Compose PostgreSQL service from the repository root with
`docker compose up -d --wait postgres`. From `src/backend`, run
`./gradlew bootRun` with Java 21. The local JDBC defaults connect to the
Compose database. Set `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`,
and `SPRING_DATASOURCE_PASSWORD` when connecting to a different database.

## Verification

From `src/backend`, run `./gradlew test` with Java 21 and Docker available. The
suite covers unit tests and calls the gRPC service through a generated client
against PostgreSQL 18.6 using Testcontainers. Flyway applies both schema
migrations during the integration tests.

## Frame management API

The [Protobuf definition](src/main/proto/frameinventory/v1/frames.proto) declares
the six RPCs. Run `./gradlew generateProto` to generate the Java messages and
stubs. The [API contract](../../docs/designs/frame-management-grpc-api.md#grpc-contract) describes
pagination, request fields, errors, and version checks.

With the backend running, call the service from `src/backend` using `grpcurl`.

```sh
grpcurl -plaintext -import-path src/main/proto -proto frameinventory/v1/frames.proto \
  -d '{"page":0,"size":25,"statuses":["LIVE","PENDING"],"search":"london"}' \
  localhost:9090 frameinventory.v1.FrameManagement/ListFrames
```

`ListFrames` accepts any number of exact status codes in `statuses`. The `search`
field matches a case-insensitive literal substring of the frame ID or town and
ignores leading and trailing whitespace. Omit either field to skip that filter.
The service applies both filters before pagination and orders by frame ID.

The backend writes structured JSON logs to the console. Set
`LOGGING_LEVEL_COM_GLOBAL_CT_FRAMEINVENTORY_FRAME=DEBUG` to include frame RPC
parameters, version checks, lookup results, and handled client errors.

## Sentry error reporting

Set `SENTRY_DSN` to the DSN of the backend's Sentry project and set
`SENTRY_ENVIRONMENT` to the environment name, such as `staging`. The environment
defaults to `local`. An empty or unset DSN disables error reporting.

Export the variables before running `./gradlew bootRun` from `src/backend`.
For Docker Compose, export the same variables or set them in an untracked
`.env` file at the repository root, then run `docker compose up --build -d backend`
to rebuild and apply the settings.

To verify reporting, use a non-production Sentry project or environment. In a
local checkout, temporarily make a controller handler throw an
`IllegalStateException` with a unique test message and call that route. Confirm
the event appears in Sentry with the expected stack trace and environment tag,
then link the event on the issue. Remove the temporary exception and confirm
`curl --fail http://localhost:8080/api/health` succeeds with the DSN configured
and again after restarting the backend with the DSN unset.

### Local import operator

The import RPC service attaches `LocalImportIdentity` as a service-scoped
interceptor. Existing frame RPCs do not use it. Enable Spring's `local-import`
profile only for host-local development and set `INVENTORY_IMPORT_LOCAL_TOKEN`
to a randomly generated 64-character lowercase hex value. Keep the credential
out of source control and logs. The RPC accepts the credential as
`authorization: Bearer <token>` only from a loopback peer and sets the fixed
`local-import-operator` identity. The interceptor checks the actual transport
peer. The Spring gRPC server can still listen on all interfaces.

The import BFF must run on the same host, accept the credential only for import
operations, and forward it alongside the existing correlation metadata. Do not
derive operator identity from a browser-supplied ID or treat ordinary frame RPC
authentication as an import credential. The single local operator can create
DELTA jobs and request force overwrite. The service rejects FULL_SNAPSHOT until the snapshot safety checks ship. Persist the verified
operator as job owner and check ownership before returning status or row
diagnostics. Production imports remain disabled until an operator identity
provider and permission policy are configured.


### Local import RPCs

Start PostgreSQL and the `aws` Compose service. Run Spring Boot on the host
with the `local-import` profile and configure these additional variables:

| Variable | Local value |
| --- | --- |
| `INVENTORY_IMPORT_BUCKET` | `frame-inventory-import-local` |
| `INVENTORY_IMPORT_REGION` | `us-east-1` |
| `INVENTORY_IMPORT_SIGNING_ENDPOINT` | `http://127.0.0.1:4566` |
| `AWS_ACCESS_KEY_ID` | `test` |
| `AWS_SECRET_ACCESS_KEY` | `test` |

`InventoryImport.CreateImportJob` creates a DELTA job and returns a PUT URL
valid for 15 minutes. Send every returned header unchanged, including
`If-None-Match: *` and the CSV content type. The caller can read the durable
summary with `GetImportJob` and the diagnostics with `ListImportRowErrors`.
Diagnostics are ordered by data row number and error code. Pages are zero-based
and default to 25 items.

`AWAITING_UPLOAD` becomes `PENDING` when dispatch binds the first accepted
object version. Dispatch must validate the event and pass the upload time and
the decoded key to the repository. A timely upload may arrive for another
15 minutes after URL expiry. The job becomes `EXPIRED` if it still has no
object at the dispatch deadline. Subsequent dispatch and worker work will move
`PENDING` to `RUNNING` and then to a terminal result. An unrecoverable dispatch
failure can move `PENDING` directly to `FAILED`. Re-delivery of the bound
version preserves its identity and status. A different version is rejected.

Final job summaries and the frame-version reference are durable. Row
diagnostics expire seven days after job completion and are purged by hourly
maintenance while the import profile is running. Worker counts and row errors
are populated by the staging and apply tasks.

### Local SQS dispatch

With the `local-import` profile enabled, set
`INVENTORY_IMPORT_DISPATCH_ENABLED=true` to poll the source queue and its
dead-letter queue. Start the `aws` and `temporal` services from the Compose import
profile.

| Variable | Local value |
| --- | --- |
| `INVENTORY_IMPORT_DISPATCH_AWS_ENDPOINT` | `http://127.0.0.1:4566` |
| `INVENTORY_IMPORT_DISPATCH_QUEUE_URL` | `http://127.0.0.1:4566/000000000000/inventory-import` |
| `INVENTORY_IMPORT_DISPATCH_DLQ_URL` | `http://127.0.0.1:4566/000000000000/inventory-import-dlq` |
| `INVENTORY_IMPORT_DISPATCH_TEMPORAL_TARGET` | `127.0.0.1:7233` (default) |
| `INVENTORY_IMPORT_DISPATCH_TEMPORAL_NAMESPACE` | `default` (default) |
| `INVENTORY_IMPORT_DISPATCH_TASK_QUEUE` | `inventory-import` (default) |

Dispatch verifies the exact object version and the 10 MiB processing cap, then
persists the binding before starting `CsvImportWorkflow` with the job ID as
its sole argument. The workflow ID is `csv-import-{jobId}`. Temporal reuses a
running execution and rejects a duplicate after it has closed. PostgreSQL records
confirmed starts so a late duplicate is harmless after Temporal history expires.
The workflow
execution timeout is one hour. The worker must claim the bound PENDING job
before applying inventory, and must exit if the claim fails.

Each SQS message is acknowledged after all applicable records are handled.
Failed source messages retry with a visibility delay starting at five seconds
and capped at one minute. SQS redrives after five receives. The dead-letter
consumer preserves jobs with a known Temporal execution. If Temporal confirms
there is no execution, it waits until the dispatch deadline before failing a
bound PENDING job. A valid event whose object binding never committed can fail
an AWAITING_UPLOAD job directly. An indeterminate lookup retries without
changing job state. Expired or terminal jobs and notifications for another
version cannot restart an import.

### DELTA processing

The [Python worker](../workflows/README.md) calls Spring over loopback for
staging and apply. The local import and dispatch settings enable these internal
RPCs. Spring reads the version pinned to the job and restarts staging from that
object if a retry loses unlogged data. A complete staging generation must
match the durable job claim before it can be applied.

DELTA expects the 45-column header from
[`inventory_frame.csv`](../../data/inventory_frame.csv). The columns can be
reordered. The parser accepts UTF-8 with an optional BOM and quoted multiline
values. Source timestamps require seconds and accept up to six fractional
digits. They are interpreted as UTC. Logical records with invalid fields or
repeated frame IDs are rejected with row diagnostics. Invalid UTF-8, broken
CSV quoting, invalid headers, and file limit breaches fail the job before
inventory writes.

Accepted frame versions, references, ordered links, row outcomes, and job
counts commit together. A replay of the same source timestamp and canonical
payload creates no extra version. Retained row diagnostics record conflicts,
including both hashes for an equal-timestamp collision.

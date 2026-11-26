# Backend

## Overview

The backend is a Java 21 Spring Boot application. Spring gRPC serves frame management on port 9090. Spring MVC and Actuator serve health endpoints on port 8080. Spring Boot applies Flyway migrations against PostgreSQL at startup. The Docker image builds a Spring Boot JAR and runs it on Java 21. [build.gradle:languageVersion] [build.gradle:dependencies] [Dockerfile:RUN] [Dockerfile:ENTRYPOINT]

## Subdirectories & Boundaries

- [Source tree](./src/README.md) contains the application and its runtime configuration.
- [Inventory migration](./src/main/resources/db/migration/V1__create_frame_inventory.sql) creates the frame, version history, and related tables.
- [Frame inventory schema](../../docs/frame-inventory-schema/frame-inventory-schema.md) maps the CSV fields and describes the shared Spring write transaction.

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
stubs. The [API contract](../../docs/frame-management-grpc-api.md#grpc-contract) describes
pagination, request fields, errors, and version checks.

With the backend running, call the service from `src/backend` using `grpcurl`.

```sh
grpcurl -plaintext -import-path src/main/proto -proto frameinventory/v1/frames.proto \
  -d '{"page":0,"size":25}' localhost:9090 frameinventory.v1.FrameManagement/ListFrames
```

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

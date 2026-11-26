# Backend

## Overview

The backend is a Java 21 Spring Boot application. It uses Spring MVC, Actuator, and JDBC. Spring Boot applies Flyway migrations against PostgreSQL at startup. The Docker image builds a Spring Boot JAR and runs it on Java 21. [build.gradle:languageVersion] [build.gradle:dependencies] [Dockerfile:RUN] [Dockerfile:ENTRYPOINT]

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

From `src/backend`, run `./gradlew test` for the database-free Spring context
check. To verify the migration, start the backend with PostgreSQL and check
`flyway_schema_history` for a successful version `1` entry.

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

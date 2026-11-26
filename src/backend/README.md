# Backend

## Overview

The backend is a Java 21 Spring Boot application. It uses Spring MVC, Actuator, and JDBC. Spring Boot applies Flyway migrations against PostgreSQL at startup. The Docker image builds a Spring Boot JAR and runs it on Java 21. [build.gradle:languageVersion] [build.gradle:dependencies] [Dockerfile:RUN] [Dockerfile:ENTRYPOINT]

## Subdirectories & Boundaries

- [Source tree](./src/README.md) contains the application and its runtime configuration.
- [Inventory migration](./src/main/resources/db/migration/V1__create_frame_inventory.sql) creates the frame, version history, and related tables.
- [Schema brief](../../concepts_brief.md) maps the CSV fields and describes the shared Spring write transaction.

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

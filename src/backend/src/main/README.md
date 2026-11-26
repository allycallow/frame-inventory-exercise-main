# Backend production sources

## Overview

The Java application and its runtime configuration are under this directory. The configuration sets port `8080` and includes `health` and `info` in the Actuator web exposure list. [resources/application.yml:server.port] [resources/application.yml:management.endpoints.web.exposure.include]

The default JDBC URL points to the `frames` database on local PostgreSQL.
Spring Boot runs the [inventory migration](./resources/db/migration/V1__create_frame_inventory.sql)
on startup. [resources/application.yml:spring.datasource.url]

## Subdirectories & Boundaries

- [Java source](./java/README.md) contains application startup and the custom health endpoint.

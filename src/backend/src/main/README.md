# Backend production sources

## Overview

The Java application and its runtime configuration are under this directory. The configuration sets port `8080` and includes `health` and `info` in the Actuator web exposure list. [resources/application.yml:server.port] [resources/application.yml:management.endpoints.web.exposure.include]

## Subdirectories & Boundaries

- [Java source](./java/README.md) contains application startup and the custom health endpoint.

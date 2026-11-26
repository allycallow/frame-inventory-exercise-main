# Frame inventory application

## Overview

This package contains the Spring Boot entry point and the HTTP health endpoint.

## Interface

- `Application.main(String[] args)` starts the Spring Boot application. [Application.java:main]
- `GET /api/health` returns the backend's status, service name, and timestamp. [HealthController.java:health]

## Invariants

- The health response has `status` set to `UP`, `service` set to `frame-inventory-backend`, and `timestamp` set to the string form of the current `Instant`. [HealthController.java:health]
- The controller allows cross-origin requests from any origin. [HealthController.java:@CrossOrigin]

## Side Effects

- `Application.main` delegates startup to `SpringApplication.run`. [Application.java:main]
- The health handler reads the system clock to build its response. [HealthController.java:health]

## Verification

From `src/backend`, run `./gradlew test`.

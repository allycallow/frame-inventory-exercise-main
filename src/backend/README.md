# Backend

## Overview

The backend is a Java 21 Spring Boot application. Its Gradle build includes Spring MVC and Actuator. The Docker image builds a Spring Boot JAR and runs it on Java 21. [build.gradle:languageVersion] [build.gradle:dependencies] [Dockerfile:RUN] [Dockerfile:ENTRYPOINT]

## Subdirectories & Boundaries

- [Source tree](./src/README.md) contains the application and its runtime configuration.

## Verification

From `src/backend`, run `./gradlew test`.

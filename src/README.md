# Application Source

## Overview

The browser calls the Next.js server on `/api/health`. The Next.js rewrite sends the request to the Spring Boot service, which returns the health response. `[frontend/src/app/page.tsx:Home]` `[frontend/next.config.ts:rewrites]` `[backend/src/main/java/com/global/ct/frameinventory/HealthController.java:health]`

Apollo Server exposes frame management through GraphQL by calling Spring Boot over gRPC. Open Apollo Sandbox directly on the BFF to browse, create, update, delete, and inspect frame history.

## Subdirectories & Boundaries

- [Backend](./backend/README.md) starts Spring Boot and serves frame management over gRPC and health over HTTP.
- [BFF](./bff/README.md) exposes the frame management API through GraphQL.
- [Frontend](./frontend/README.md) serves the smoke-check page and rewrites API requests to the backend.

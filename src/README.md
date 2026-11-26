# Application Source

## Overview

The browser calls the Next.js server on `/api/health`. The Next.js rewrite sends the request to the Spring Boot service, which returns the health response. `[frontend/src/app/page.tsx:Home]` `[frontend/next.config.ts:rewrites]` `[backend/src/main/java/com/global/ct/frameinventory/HealthController.java:health]`

## Subdirectories & Boundaries

- [Backend](./backend/README.md) starts Spring Boot and serves the health endpoint.
- [Frontend](./frontend/README.md) serves the smoke-check page and rewrites API requests to the backend.

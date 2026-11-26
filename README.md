# Frame Inventory

Monorepo scaffold for the frame-inventory take-home exercise.

## System Overview

The Next.js page calls the Spring Boot health endpoint through a same-origin rewrite. Docker Compose runs both modules alongside PostgreSQL, OpenSearch, and OpenSearch Dashboards. The exercise provides a legacy export in `data/inventory_frame.csv` and describes the inventory features in `INSTRUCTIONS.md`.

Bring the whole stack up with one command.

```bash
docker compose up --build
```

## Subdirectories & System Boundaries

- [Application source](./src/README.md) contains the Java 21 and Spring Boot 3.5 backend and the Next.js, React 19, and TypeScript frontend.
- [Design system](./design-system/README.md) contains the prototype, sample frame data, and visual conventions for the exercise.

## Services

`docker compose up` starts the following services.

| Service               | Host port | Container port | Notes                                                  |
|-----------------------|-----------|----------------|--------------------------------------------------------|
| frontend              | 3000      | 3000           | Next.js dev server, proxies `/api` to the backend     |
| backend               | 8080      | 8080           | Spring Boot, exposes `GET /api/health`                 |
| postgres              | 5432      | 5432           | Spring Boot applies the inventory schema via Flyway    |
| opensearch            | 9200, 9600 | 9200, 9600    | Single-node, security plugin disabled for local use    |
| opensearch-dashboards | 5601      | 5601           | UI for the OpenSearch cluster above                    |

### Credentials

| Service               | User       | Password       | Database         |
|-----------------------|------------|----------------|------------------|
| postgres              | `app`      | `app`          | `frames`         |
| opensearch            | n/a        | n/a            | n/a              |

## Global Invariants

- The Next.js rewrite preserves the `/api/` path and uses `BACKEND_URL` as its destination origin. Compose sets it to `http://backend:8080`. `[src/frontend/next.config.ts:rewrites]` `[docker-compose.yml:services.frontend.environment.BACKEND_URL]`
- The health page expects `status`, `service`, and `timestamp` from `GET /api/health`. The backend supplies those fields directly. `[src/frontend/src/app/page.tsx:HealthResponse]` `[src/backend/src/main/java/com/global/ct/frameinventory/HealthController.java:health]`

## Global Side Effects

- Opening the frontend requests `/api/health`, which the Next.js server forwards to the backend. The response reports the current time from the backend clock. `[src/frontend/src/app/page.tsx:Home]` `[src/frontend/next.config.ts:rewrites]` `[src/backend/src/main/java/com/global/ct/frameinventory/HealthController.java:health]`
- Docker Compose publishes service ports and creates named volumes for PostgreSQL and OpenSearch. OpenSearch Dashboards connects to OpenSearch on the Compose network. `[docker-compose.yml:services]` `[docker-compose.yml:volumes]` `[docker-compose.yml:services.opensearch-dashboards.environment.OPENSEARCH_HOSTS]`

## System Verification

- From `src/backend`, run `./gradlew test`.
- From `src/frontend`, run `npm run lint` after installing dependencies.

### Smoke test

Once the stack is up, check both entry points.

- Open <http://localhost:3000> &mdash; the page calls `/api/health` and prints the JSON response.
- Hit the backend directly: <http://localhost:8080/api/health>.

## Running modules without Docker

### Backend

Start PostgreSQL before running the backend locally. Spring Boot applies the
Flyway migrations on startup.

```bash
docker compose up -d --wait postgres
cd src/backend
./gradlew bootRun
```

### Frontend

```bash
cd src/frontend
npm install
npm run dev
```

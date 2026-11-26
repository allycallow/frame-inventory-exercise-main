# Frame Inventory

Application for the frame-inventory take-home exercise.

## System Overview

Next.js serves the inventory and import workspace. It sends GraphQL requests through a same-origin route to the BFF, which calls Spring Boot over gRPC. Docker Compose runs these services alongside PostgreSQL, Prometheus, Grafana, Loki, Alloy, and the OpenTelemetry Collector. The exercise provides a legacy export in `data/inventory_frame.csv` and describes the inventory features in `INSTRUCTIONS.md`.

Bring the whole stack up with one command.

```bash
docker compose up --build
```

Once PostgreSQL is healthy, the backend applies pending Flyway migrations during startup.

If you have `just` installed, run `just` to list the available recipes.

| Command | Purpose |
|---------|---------|
| `just up` | Build and start the whole stack in the foreground. |
| `just down` | Stop the stack and retain its named data volumes. |
| `just compose logs -f backend` | Pass arguments through to Docker Compose. |
| `just migrate` | Run Flyway on its own in a one-off backend container. |

## Subdirectories & System Boundaries

- [Application source](./src/README.md) contains the Spring Boot backend, Apollo Server BFF, and Next.js frontend.
- [Design system](./design-system/README.md) contains the prototype, sample frame data, and visual conventions for the exercise.

## Services

`docker compose up` starts the following services.

| Service               | Host port | Container port | Notes                                                  |
|-----------------------|-----------|----------------|--------------------------------------------------------|
| frontend              | 3000      | 3000           | Next.js workspace and same-origin GraphQL route     |
| bff                   | 4000      | 4000           | Apollo Sandbox and the frame inventory GraphQL API     |
| backend               | 8080      | 8080           | Spring Boot, exposes `GET /api/health`                 |
| postgres              | 5432      | 5432           | Spring Boot applies the inventory schema via Flyway    |
| prometheus            | 9091      | 9090           | Scrapes Spring Boot and Apollo metrics every 15 seconds |
| otel-collector        | 9464      | 9464           | Scrapes Spring Boot metrics for local inspection       |
| grafana               | 3001      | 3000           | Queries provisioned Prometheus and Loki data            |

### Credentials

| Service               | User       | Password       | Database         |
|-----------------------|------------|----------------|------------------|
| postgres              | `app`      | `app`          | `frames`         |
| grafana               | `admin`    | `admin`         | n/a              |

## Global Invariants

- The Next.js rewrite preserves the `/api/` path and uses `BACKEND_URL` as its destination origin. Compose sets it to `http://backend:8080`. `[src/frontend/next.config.ts:rewrites]` `[docker-compose.yml:services.frontend.environment.BACKEND_URL]`
- The Next.js `/api/graphql` route proxies GraphQL to `BFF_URL`. Compose sets it to `http://bff:4000`.

## Global Side Effects

- Opening the frontend loads the first page of frames. Starting an import uploads the file directly to S3 using the signed URL returned by the BFF.
- Docker Compose publishes service ports and creates named volumes for PostgreSQL, Prometheus, Grafana, Loki, and Alloy. `[docker-compose.yml:services]` `[docker-compose.yml:volumes]`

## System Verification

- From `src/backend`, run `./gradlew test`.
- From `src/frontend`, run `npm run lint` after installing dependencies.

### Git hooks

Install [pre-commit](https://pre-commit.com/#installation), then run `pre-commit install`
from the repository root to install both Git hooks. The `pre-commit` hook checks
YAML, JSON, and merge conflict markers, and runs ESLint when staged changes touch
`src/frontend/`. Install the frontend dependencies with `npm ci --prefix src/frontend`
before committing frontend changes.

The `commit-msg` hook uses Commitlint to enforce the Conventional Commits format
documented in [AGENTS.md](./AGENTS.md). Commitlint requires Node.js 22.12 or newer.

Run `pre-commit run --all-files` to check the whole repository.

### Smoke test

Once the stack is up, check the service entry points.

- Open <http://localhost:3000> to view the frame list. See the [frontend setup](./src/frontend/README.md) to enable local imports.
- Hit the backend directly: <http://localhost:8080/api/health>.
- Open [Apollo Sandbox](http://127.0.0.1:4000) and run the [frame list query](./src/bff/README.md).

### Backend metrics

- Open [Prometheus Targets](http://127.0.0.1:9091/targets) and wait for the
  `frame-inventory-backend` target to show **UP**. It scrapes
  `http://backend:8080/actuator/prometheus` on the Compose network.
- Open [Grafana](http://127.0.0.1:3001), sign in with the initial credentials
  above, and run `up{job="frame-inventory-backend"}` in **Explore** using the
  default Prometheus data source. A value of `1` confirms the backend is being scraped.
- Open [Frame Inventory Backend](http://127.0.0.1:3001/d/frame-inventory-backend/frame-inventory-backend)
  for HTTP and gRPC request rate, errors, p50, p95, and p99 latency, and resource saturation.
  Generate API traffic and allow at least two Prometheus scrapes for request graphs
  to populate.
- The **Frame inventory activity** section shows committed creates, updates, and
  soft deletes, plus successful gRPC reads and version conflicts. The totals cover
  the dashboard time range. Rejected or rolled-back writes and repeated deletes
  that change no data are excluded from the totals.

Prometheus and Grafana listen on localhost. Their named volumes keep metrics
and Grafana settings across restarts.

### BFF metrics

Run `docker compose up -d --build bff prometheus grafana`. If Prometheus was
already running, reload its scrape configuration with
`docker compose restart prometheus`. Confirm that `frame-inventory-bff` is
**UP** in [Prometheus Targets](http://127.0.0.1:9091/targets). Prometheus scrapes
`http://bff:9465/metrics` on the Compose network.

Open [Frame Inventory BFF](http://127.0.0.1:3001/d/frame-inventory-bff/frame-inventory-bff)
for GraphQL request rate, error percentage, p50/p95/p99 latency, in-flight
requests, and event loop utilization. The **Slowest queries and mutations (p95)**
panel ranks top-level fields such as `frames` and `updateFrame` by resolver
latency over the selected time range. Run the [frame list query](./src/bff/README.md)
several times across at least two scrapes. Run `{ frames(page: -1) { page } }`
to generate a GraphQL error. The dashboard counts GraphQL errors even when
Apollo responds with HTTP 200.

### Backend and BFF logs

Run `docker compose up -d --build bff grafana`. Alloy reads the backend and
BFF containers’ stdout and stderr through the Docker socket and sends them
to Loki. Loki stores logs in the `loki-data` volume with seven-day retention.
For a failed GraphQL request, take the `X-Correlation-Id` response header
and search both services with
`{service_name=~"backend|bff"} | json | correlationId="your-id"`.
For a production deployment, configure log storage, retention, and access
controls for that environment.

Open [Grafana Explore](http://127.0.0.1:3001/explore), select **Loki**,
and switch to **Code** mode to run either LogQL query.

- Backend — `{service_name="backend"}`
- BFF — `{service_name="bff"}`

### OpenTelemetry Collector

Run `docker compose up -d --build otel-collector` to start the Collector and its
dependencies. The Collector scrapes `http://backend:8080/actuator/prometheus`
every 15 seconds and exposes the latest samples on localhost. Once the backend
is ready and the first scrape completes, check for a JVM metric from Spring Boot.

```bash
curl --fail --silent --show-error http://127.0.0.1:9464/metrics | rg '^jvm_memory_used_bytes\{'
```

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

## Inventory import development services

See [inventory import infrastructure](infra/inventory-import/README.md) for the
opt-in S3/SQS emulator and Temporal profile, Terraform, and smoke test.

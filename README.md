# Frame Inventory

Monorepo scaffold for the frame-inventory take-home exercise. Bring the whole stack up with one command:

```bash
docker compose up --build
```

## Modules

| Module    | Stack                               | Path            |
|-----------|-------------------------------------|-----------------|
| backend   | Java 21, Spring Boot 3.5, Gradle    | `src/backend/`  |
| frontend  | Next.js, React 19, TypeScript      | `src/frontend/` |

## Services

`docker compose up` starts every dependency the exercise needs:

| Service               | Host port | Container port | Notes                                                  |
|-----------------------|-----------|----------------|--------------------------------------------------------|
| frontend              | 3000      | 3000           | Next.js dev server, proxies `/api` to the backend     |
| backend               | 8080      | 8080           | Spring Boot, exposes `GET /api/health`                 |
| mongodb               | 27017     | 27017          | Intended for frame data                                |
| postgres              | 5432      | 5432           | Intended for frame data                                |
| opensearch            | 9200      | 9200           | Single-node, security plugin disabled for local use    |
| opensearch-dashboards | 5601      | 5601           | UI for the OpenSearch cluster above                    |

### Credentials

| Service               | User       | Password       | Database         |
|-----------------------|------------|----------------|------------------|
| mongodb               | `root`     | `root`         | `frames`         |
| postgres              | `app`      | `app`          | `frames`         |
| opensearch            | n/a (security disabled)                                |

## Smoke test

Once the stack is up:

- Open <http://localhost:3000> &mdash; the page calls `/api/health` and prints the JSON response.
- Hit the backend directly: <http://localhost:8080/api/health>.

## Running modules without Docker

### Backend

```bash
cd src/backend
./gradlew bootRun
```

### Frontend

```bash
cd src/frontend
npm install
npm run dev
```

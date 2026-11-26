# Frontend (Next.js)

The App Router shows the paginated frame inventory, version history, and DELTA
imports. Frame history links to the durable import job summary, which remains
available after row diagnostics expire.

The browser sends GraphQL requests to the same-origin `/api/graphql` route.
Set `BFF_URL` to the BFF origin or full GraphQL URL. It defaults to
`http://127.0.0.1:4000` and Compose uses `http://bff:4000`. The existing
`/api/:path*` fallback forwards requests such as health checks to
`BACKEND_URL` (default `http://localhost:8080`).

## Local development

Run `npm ci` and `npm run dev` from `src/frontend`. For local imports, run
Spring Boot and the BFF on the host and enable their local import settings.
Start the frontend with `npm run dev -- --hostname 127.0.0.1` for this flow.
See the [backend README](../backend/README.md) and [BFF README](../bff/README.md).
In **Imports**, enter the local operator token and select the CSV file.
The browser sends the file directly to the S3 URL with the signed headers.
Keep the frontend origin in the upload bucket's CORS configuration.

The frontend keeps the operator token in memory for this session. To reopen an
import, use its job ID or select the import link in a frame's version history.
Run `npm run lint` and `npm run build` to verify the frontend.

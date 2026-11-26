# App Router

The home route displays a paginated frame list and a DELTA import workspace.
Selecting a frame ID opens its version history with links to associated import
jobs.

The same-origin GraphQL route uses the server-side BFF URL. The browser keeps
the local operator token in memory and supplies it for import operations.
CSV uploads go directly to the presigned S3 URL. Job status and diagnostics
continue to use the GraphQL route.

See the [frontend setup](../../README.md) for running and verification.

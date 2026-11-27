# App Router

The home route redirects to the paginated frame list at `/frames`. The DELTA
import workspace is at `/imports`, and tracked jobs open at `/imports/<jobId>`.
Selecting a frame ID opens the detail view at `/frames/<frameId>` with all
attributes, external references and links to related frames. Choose **Edit** to
update a frame with a current version. Open **Version history** to see frame
versions and links to associated import jobs.

The same-origin GraphQL route uses the server-side BFF URL. The browser keeps
the local operator token in memory and supplies it for import operations.
CSV uploads go directly to the presigned S3 URL. Job status and diagnostics
continue to use the GraphQL route.

See the [frontend setup](../../README.md) for running and verification.

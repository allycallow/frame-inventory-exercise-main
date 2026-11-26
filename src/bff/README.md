# Frame Inventory BFF

From the repository root, run `docker compose up --build bff`. Open [Apollo Sandbox](http://127.0.0.1:4000) and run:

```graphql
query ListFrames {
  frames(page: 0, size: 25) {
    items {
      frameId
      versionId
      attributes {
        status
        address
      }
    }
    page
    size
    hasNext
  }
}
```

The query uses the backend's zero-based pagination. Omitted arguments use page
`0` and size `25`. Sizes from `1` through `50` are valid. An empty inventory
returns an empty list with `hasNext: false`.

When Spring rejects invalid input, the GraphQL error has code `BAD_USER_INPUT`.
If the backend supplies validation details, `extensions.fieldViolations`
contains `{ field, description }` entries using backend property paths.
Other input errors may not include this extension.

## Frame lifecycle in Apollo Sandbox

Paste these operations into Sandbox. Run **Create** with variables
`{"id":"sandbox-frame-001"}`. Use a fresh ID for each run, since Spring reserves
frame IDs after their first use, including after deletion.

```graphql
fragment Snapshot on Frame {
  frameId
  versionId
  current
  validFrom
  validTo
  changeSource
  closedByChangeSource
  attributes {
    status
    address
  }
}

mutation Create($id: ID!) {
  createFrame(
    frameId: $id
    attributes: { status: DRAFT, address: "Test site" }
  ) {
    ...Snapshot
  }
}

query Read($id: ID!) {
  frame(frameId: $id) {
    ...Snapshot
  }
}

mutation Update($id: ID!, $version: String!) {
  updateFrame(
    frameId: $id
    expectedVersionId: $version
    attributes: { status: LIVE, address: "Test site" }
  ) {
    ...Snapshot
  }
}

query History($id: ID!) {
  frameHistory(frameId: $id) {
    ...Snapshot
  }
}

mutation Delete($id: ID!, $version: String!) {
  deleteFrame(frameId: $id, expectedVersionId: $version)
}
```

1. Run **Read** to confirm the frame exists. Copy the returned `versionId` into
   the `version` variable as a JSON string and run **Update**. Updates replace
   writable attributes, so include any optional values you want to retain.
2. Run **History** to see the new version followed by the original. Running
   **Update** again with the original version should return `CONFLICT`.
3. Set `version` to the version returned by **Update**, then run **Delete**.
   Expect `true`. **Read** returns `NOT_FOUND` and **History** still shows both
   versions, with `MANUAL_DELETE` closing the latest one.

## Local development

To run the BFF outside Docker, start the backend, then run `npm ci`,
`npm run build`, and `npm start` from `src/bff`. The build generates TypeScript
types from the backend's Protobuf definition and copies `frames.proto` into
`dist/proto/` for the gRPC client. Set `FRAME_GRPC_ENDPOINT` to the Spring gRPC
endpoint as `host:port`. It defaults to `localhost:9090` for local runs and
`backend:9090` in Docker Compose.

Apollo loads the `.gql` schema files from [`schema/`](./schema/) at startup.
The resolver implementations live in [`src/resolvers/`](./src/resolvers/).
The build runs GraphQL Codegen to generate TypeScript resolver types from the
same files. Run `npm run codegen` to regenerate the resolver types on their own.

For a local run, Apollo's OpenTelemetry metrics are available at
`http://127.0.0.1:9465/metrics`. They cover requests that enter Apollo's GraphQL
pipeline. Parse, validation, and resolver errors count as failed requests.
Request metrics use operation type and outcome. A separate histogram measures
top-level resolver time, including upstream gRPC calls, by operation type and
schema field name. Client-chosen operation names and aliases are excluded from
the labels. See the [BFF metrics dashboard](../../README.md#bff-metrics) for the
Compose setup.

Run `npm run lint` and `npm run format:check` to check the BFF. Run
`npm run format` to apply Prettier. Run `npm test` to generate types, type-check
the test, and run it through ts-jest with a stub gRPC client.

## Sentry error reporting

Set `SENTRY_DSN` to the BFF Sentry project's DSN before starting the service.
For Compose, set `BFF_SENTRY_DSN` instead. Set `SENTRY_ENVIRONMENT` to label events by
deployment environment. An unset or empty DSN leaves reporting disabled.

Apollo reports unexpected execution errors, internal server errors, and
upstream unavailability. Expected GraphQL validation and domain errors are
excluded. The SDK strips request data and breadcrumbs from reported events.

## Local inventory import

The BFF build packages both the frame and inventory import protobufs. For local
imports, run Spring Boot and the BFF on the same host. Enable Spring's
`local-import` profile and configure its S3 upload settings as described in the
[backend README](../backend/README.md). Set
`IMPORT_GRPC_ENDPOINT=127.0.0.1:9090` on the BFF. This makes the BFF listen on
IPv4 loopback and limits the import gRPC target to IPv4 loopback. With the
variable unset, the import resolvers return `SERVICE_UNAVAILABLE` and frame
operations remain available.

Send the local operator token as `Authorization: Bearer <token>` with
`createImportJob`, `importJob`, and `importRowErrors`. Only these resolvers
forward the credential to Spring, which verifies the token and checks job
ownership. Use the returned `uploadHeaders` values for the direct S3 PUT, then
poll the job and request row errors by page. Keep the credential and signed
URL out of application logs.

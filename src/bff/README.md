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

Run `npm run lint` and `npm run format:check` to check the BFF. Run
`npm run format` to apply Prettier. Run `npm test` to generate types, type-check
the test, and run it through ts-jest with a stub gRPC client.

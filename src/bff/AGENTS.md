# BFF development instructions

## Service boundaries

- This package is a standalone Apollo Server 5 service written in strict
  TypeScript. Use Node.js 22 and npm to match Docker and GitHub Actions.
- Apollo owns the GraphQL contract, pagination input validation, and translation
  of gRPC responses and errors. Keep inventory rules and persistence in Spring Boot.
- Use Apollo Sandbox directly at `http://127.0.0.1:4000/`. The Next.js application
  has its own entry point. See [README.md](./README.md) for a sample query.

## Schema and generated types

- Put GraphQL SDL in `schema/*.gql` and resolver implementations in
  `src/resolvers/`. `src/server.ts` loads the SDL with
  `@graphql-tools/load-files` and wires the resolvers into Apollo.
- Use the generated `Resolvers` type for resolver maps. GraphQL Codegen reads the
  same SDL as Apollo. `codegen.yml` maps GraphQL `Frame` to the generated gRPC
  output type.
- Use the [backend's frames.proto](../backend/src/main/proto/frameinventory/v1/frames.proto)
  as the Protobuf source of truth. Keep 64-bit version IDs as strings across
  the gRPC and GraphQL boundary.
- Regenerate files in `src/generated/` with `npm run generate`. The build also
  copies the canonical `frames.proto` to `dist/proto/frames.proto` for the
  runtime gRPC client.

## Validate resolver inputs

- Validate the allowed ranges and combinations of GraphQL arguments at the
  resolver boundary before making an upstream call. Keep these checks aligned
  with Spring's contract and preserve omission where Spring supplies a default.
- For each validation rule, test a valid boundary and a rejected value. Check
  that invalid input returns `BAD_USER_INPUT` and leaves the gRPC stub uncalled.
- The GraphQL `frames` query calls Spring's `ListFrames` RPC and returns
  `items`, `page`, `size`, and `hasNext`. Reject negative pages, sizes outside
  `1–50`, and null characters in `statuses` or `search` before calling gRPC.
  Treat omitted or null arguments as unset so Spring applies page `0`, size
  `25`, and no filters.
- The remaining operations are `frame`, `frameHistory`, `createFrame`,
  `updateFrame`, and `deleteFrame`. Pass expected version IDs to gRPC as
  positive 64-bit integer strings. An update replaces writable attributes.
- Throw `GraphQLError` with an `extensions.code` from `src/consts.ts`.
  The shared mapping in `src/frame-client.ts` uses `BAD_USER_INPUT` for
  `INVALID_ARGUMENT`, `NOT_FOUND` for missing frames, `ALREADY_EXISTS` for
  reserved IDs, `CONFLICT` for gRPC `ABORTED`, `SERVICE_UNAVAILABLE` for
  `UNAVAILABLE` or `DEADLINE_EXCEEDED`, and `INTERNAL_SERVER_ERROR` for
  unexpected failures.

## Logging and retries

- Cockatiel 3 supports the BFF's CommonJS build and Jest setup. Read-only RPCs
  retry only `UNAVAILABLE`, at most twice with 100 ms backoff. Every attempt
  shares the same five-second gRPC deadline. Send each mutation once.
- Use the shared Pino logger in `src/logger.ts` for structured service logs.
  Use `logger.info` for service lifecycle events such as startup. Use
  `logger.debug` for request-level diagnostics such as RPC duration or retry
  attempt number. Pino defaults to `info`. Set the logger level to `debug`
  when troubleshooting locally.
- Put diagnostic values in structured fields. Keep request payloads,
  credentials, and frame IDs out of logs. Log upstream status codes for service
  failures and keep client error messages generic for unexpected failures.
- Inspect Compose logs with `docker compose logs bff` from the repository root.

## Run and verify

- From the repository root, start the Compose service with
  `docker compose up --build bff`. The multi-stage image builds the code and
  packages its output, SDL, and production dependencies for the runtime stage.
- For a local run, start Spring, then run `npm ci`, `npm run build`, and
  `npm start` from `src/bff`. Set `FRAME_GRPC_ENDPOINT` as `host:port` when
  overriding the default of `localhost:9090` locally or `backend:9090` in
  Compose. The client also accepts the older `FRAME_GRPC_TARGET` as a fallback.
- From `src/bff`, run `npm run format:check`, `npm run lint`, and `npm test`.
  Use `npm run format` to apply Prettier. The
  [BFF workflow](../../.github/workflows/bff-checks.yml) runs the checks on pull
  requests and pushes to `main`.
- Write query tests in TypeScript under `test/`. Use Apollo's
  `executeOperation` with a stub gRPC client to check GraphQL data, error codes,
  and which calls reach Spring. `npm test` generates types, type-checks the
  tests, and runs them through ts-jest.

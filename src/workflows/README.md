# Inventory workflows

The Python worker polls Temporal's `inventory-import` task queue. Spring starts
`CsvImportWorkflow` when SQS delivers the upload notification. Python sequences
`Stage`, `Apply`, and `Fail`, forwards staging progress as Temporal heartbeats,
and controls activity retries. Spring streams the pinned S3 object, validates
the CSV, and writes the job result and inventory versions in PostgreSQL.

## Run locally

The root `docker compose up -d --build --wait` command starts the worker.
Set `INVENTORY_IMPORT_LOCAL_TOKEN` in the root `.env` to enable polling.
The worker shares the Spring container's loopback interface and uses the local
token for the internal gRPC service. The Temporal UI is at
<http://127.0.0.1:8233>.

For a host-based run, start Spring on gRPC port 9090 with
[local imports and dispatch enabled](../backend/README.md#local-sqs-dispatch).
Then generate the Python stubs and start the worker from this directory with
Python 3.12 and [uv](https://docs.astral.sh/uv/). Use the same token as Spring.

```sh
mkdir -p .generated
uv run --locked python -m grpc_tools.protoc \
  -I ../backend/src/main/proto --python_out=.generated --grpc_python_out=.generated \
  ../backend/src/main/proto/frameinventory/v1/import_worker.proto
export "$(sed -n '/^INVENTORY_IMPORT_LOCAL_TOKEN=/p' ../../.env)"
PYTHONPATH=.generated uv run --locked python -m inventory_workflows
```

The worker uses `127.0.0.1:7233` and Temporal's `default` namespace by default.
When overriding the target, namespace or task queue, use the same
`INVENTORY_IMPORT_DISPATCH_TEMPORAL_TARGET`,
`INVENTORY_IMPORT_DISPATCH_TEMPORAL_NAMESPACE`, and
`INVENTORY_IMPORT_DISPATCH_TASK_QUEUE` settings as Spring.

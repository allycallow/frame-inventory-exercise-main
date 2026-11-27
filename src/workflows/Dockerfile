FROM ghcr.io/astral-sh/uv:0.12.14 AS uv
FROM python:3.12-slim AS build
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
COPY workflows/pyproject.toml workflows/uv.lock ./
RUN uv sync --locked
COPY backend/src/main/proto/frameinventory/v1/import_worker.proto /proto/frameinventory/v1/
RUN uv run --no-sync python -m grpc_tools.protoc -I /proto --python_out=/app --grpc_python_out=/app \
    /proto/frameinventory/v1/import_worker.proto \
    && uv sync --locked --no-dev

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY --from=build /app/.venv .venv
COPY --from=build /app/frameinventory frameinventory
COPY workflows/inventory_workflows inventory_workflows
USER 65532:65532
CMD ["/app/.venv/bin/python", "-m", "inventory_workflows"]

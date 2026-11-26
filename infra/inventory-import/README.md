# Inventory import infrastructure

This Terraform root provisions a dedicated versioned S3 bucket, a standard SQS
queue, and a dead-letter queue in one region. S3 sends PUT notifications for
`uploads/*/inventory_frame.csv` directly to the source queue. Attach the
output application policy to the backend's existing execution role. The
backend will use the bucket name and both queue URLs as import configuration.

## Local development

From the repository root:

```sh
docker compose --profile import up -d --wait aws temporal
```

The profile pins the LocalStack community image from before token activation
became mandatory. It exposes S3/SQS on `127.0.0.1:4566` and Temporal on
`127.0.0.1:7233` with UI on port 8233. Containers on the Compose network can
reach `aws:4566` and `temporal:7233`. Use the loopback S3 endpoint
with path-style addressing when signing URLs for a host browser. The ready hook
creates the bucket, queues and notification. The smoke test is intended to run
before starting a queue consumer.

```sh
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test uv run infra/inventory-import/smoke.py \
  --endpoint http://127.0.0.1:4566 --region us-east-1 \
  --bucket frame-inventory-import-local --origin http://localhost:3000 \
  --queue-url http://127.0.0.1:4566/000000000000/inventory-import \
  --dlq-url http://127.0.0.1:4566/000000000000/inventory-import-dlq
```

## AWS sandbox

Use a dedicated sandbox account or a dedicated stack with idle queues. Configure
a remote state backend before sharing a deployment. An existing S3 state bucket
with locking enabled (`use_lockfile = true`) and a separate key for each
environment is suitable. Store state outside the import bucket. Supply
`aws_region`, `bucket_name`, `name_prefix` and `frontend_origins` with a local
`.tfvars` file or `TF_VAR_*` environment variables.

From this directory, initialize state and review a plan with sandbox
credentials:

```sh
terraform init \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="key=inventory-import/sandbox.tfstate" \
  -backend-config="region=$STATE_REGION" \
  -backend-config="use_lockfile=true"
terraform validate
terraform plan -out=sandbox.tfplan
```

Apply the reviewed plan in the sandbox. AWS recommends allowing up to 15
minutes for first-time S3 versioning to propagate before writing objects.
For static validation without AWS credentials, use
`terraform init -backend=false` followed by `terraform validate`.

Run the same smoke script with sandbox credentials for the application role,
the configured region and frontend origin, and the Terraform bucket and queue
outputs. Omit `--endpoint`. It checks browser CORS headers, a signed create-only
PUT and rejected replay, version-pinned reads, version-bearing notifications,
and DLQ redrive. The script creates one unique test object and deletes only the
matched event from the DLQ. Leave the test object to the lifecycle policy.

S3 makes live upload objects eligible for expiration after seven days. On a
versioned bucket this creates a delete marker. The underlying noncurrent
version is eligible for permanent expiration after one additional day. Cleanup
is asynchronous. Keep workflow and dispatch retries within the seven-day
window. The standard queue retains messages for four days and the DLQ retains
them for up to fourteen days from the original enqueue time.

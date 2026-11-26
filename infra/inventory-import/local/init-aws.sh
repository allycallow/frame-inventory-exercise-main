#!/usr/bin/env bash
set -euo pipefail

ready_file=/tmp/inventory-import-ready
rm -f "$ready_file"
bucket=frame-inventory-import-local

awslocal s3api create-bucket --bucket "$bucket"
awslocal s3api put-bucket-versioning --bucket "$bucket" \
  --versioning-configuration Status=Enabled
awslocal s3api put-bucket-cors --bucket "$bucket" \
  --cors-configuration '{"CORSRules":[{"AllowedOrigins":["http://localhost:3000","http://127.0.0.1:3000"],"AllowedMethods":["PUT"],"AllowedHeaders":["Content-Type","If-None-Match"],"ExposeHeaders":["ETag","x-amz-version-id"]}]}'

dlq_url=$(awslocal sqs create-queue --queue-name inventory-import-dlq \
  --query QueueUrl --output text)
dlq_arn=$(awslocal sqs get-queue-attributes --queue-url "$dlq_url" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)
queue_url=$(awslocal sqs create-queue --queue-name inventory-import \
  --query QueueUrl --output text)
queue_arn=$(awslocal sqs get-queue-attributes --queue-url "$queue_url" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)

attributes=$(python3 - "$queue_arn" "$dlq_arn" "$bucket" <<'PY'
import json
import sys

queue, dlq, bucket = sys.argv[1:]
print(json.dumps({
    "VisibilityTimeout": "120",
    "ReceiveMessageWaitTimeSeconds": "20",
    "RedrivePolicy": json.dumps({"deadLetterTargetArn": dlq, "maxReceiveCount": 5}),
    "Policy": json.dumps({"Version": "2012-10-17", "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "s3.amazonaws.com"},
        "Action": "sqs:SendMessage",
        "Resource": queue,
        "Condition": {"ArnEquals": {"aws:SourceArn": f"arn:aws:s3:::{bucket}"}},
    }]}),
}))
PY
)
awslocal sqs set-queue-attributes --queue-url "$queue_url" --attributes "$attributes"
awslocal s3api put-bucket-notification-configuration --bucket "$bucket" \
  --notification-configuration "{
    \"QueueConfigurations\": [{
      \"QueueArn\": \"$queue_arn\",
      \"Events\": [\"s3:ObjectCreated:Put\"],
      \"Filter\": {\"Key\": {\"FilterRules\": [
        {\"Name\": \"prefix\", \"Value\": \"uploads/\"},
        {\"Name\": \"suffix\", \"Value\": \"/inventory_frame.csv\"}
      ]}}
    }]
  }"
touch "$ready_file"

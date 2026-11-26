# /// script
# requires-python = ">=3.10"
# dependencies = ["boto3==1.40.45"]
# ///
"""Verify a dedicated, idle import stack before enabling consumers."""

import argparse
import json
import time
import uuid
from urllib.error import HTTPError
from urllib.parse import unquote_plus
from urllib.request import Request, urlopen

import boto3
from botocore.config import Config


def matches(message, bucket, key, version):
    body = json.loads(message["Body"])
    return any(
        record.get("eventName") == "ObjectCreated:Put"
        and record["s3"]["bucket"]["name"] == bucket
        and unquote_plus(record["s3"]["object"]["key"]) == key
        and record["s3"]["object"].get("versionId") == version
        for record in body.get("Records", [])
    )


def receive(sqs, queue, bucket, key, version, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = sqs.receive_message(QueueUrl=queue, WaitTimeSeconds=5)
        for message in result.get("Messages", []):
            if matches(message, bucket, key, version):
                return message
    raise RuntimeError("Expected S3 notification did not reach the queue with the uploaded version ID")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", required=True)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--queue-url", required=True)
    parser.add_argument("--dlq-url", required=True)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--endpoint", help="Set for the local emulator only")
    args = parser.parse_args()

    # Sign for the regional bucket endpoint, the same host the browser uploads to.
    config = Config(signature_version="s3v4", s3={
        "addressing_style": "path" if args.endpoint else "virtual",
        "us_east_1_regional_endpoint": "regional",
    })
    s3 = boto3.client("s3", region_name=args.region, endpoint_url=args.endpoint, config=config)
    sqs = boto3.client("sqs", region_name=args.region, endpoint_url=args.endpoint)
    key = f"uploads/{uuid.uuid4()}/inventory_frame.csv"
    payload = b"frame_id\nsmoke-test\n"
    url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": args.bucket, "Key": key, "IfNoneMatch": "*", "ContentType": "text/csv"},
        ExpiresIn=300,
    )
    options = Request(url, method="OPTIONS", headers={
        "Origin": args.origin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type,if-none-match",
    })
    with urlopen(options, timeout=15) as response:
        if response.headers.get("Access-Control-Allow-Origin") != args.origin:
            raise RuntimeError("PUT CORS preflight did not allow the frontend origin")

    upload = Request(url, data=payload, method="PUT", headers={
        "Origin": args.origin, "If-None-Match": "*", "Content-Type": "text/csv",
    })
    with urlopen(upload, timeout=15) as response:
        version = response.headers.get("x-amz-version-id")
        if not version or version == "null":
            raise RuntimeError("Upload did not create an S3 object version")
    try:
        with urlopen(upload, timeout=15):
            raise RuntimeError("Repeated create-only PUT unexpectedly succeeded")
    except HTTPError as error:
        if error.code != 412:
            raise RuntimeError(f"Repeated PUT returned {error.code}, expected 412") from error

    body = s3.get_object(Bucket=args.bucket, Key=key, VersionId=version)["Body"]
    with body:
        if body.read() != payload:
            raise RuntimeError("Pinned S3 object version returned unexpected content")

    # Let the matching event fail processing repeatedly. Other messages are never deleted.
    for _ in range(5):
        message = receive(sqs, args.queue_url, args.bucket, key, version, 60)
        sqs.change_message_visibility(
            QueueUrl=args.queue_url, ReceiptHandle=message["ReceiptHandle"], VisibilityTimeout=0,
        )
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        # Poll the source again so SQS can evaluate the redrive threshold.
        sqs.receive_message(QueueUrl=args.queue_url, WaitTimeSeconds=1)
        result = sqs.receive_message(QueueUrl=args.dlq_url, WaitTimeSeconds=2)
        for message in result.get("Messages", []):
            if matches(message, args.bucket, key, version):
                sqs.delete_message(QueueUrl=args.dlq_url, ReceiptHandle=message["ReceiptHandle"])
                break
        else:
            continue
        break
    else:
        raise RuntimeError("The versioned upload notification did not redrive to the DLQ")
    print("Verified CORS, create-only PUT, pinned read, versioned notification, and redrive")


if __name__ == "__main__":
    main()

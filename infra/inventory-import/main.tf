data "aws_caller_identity" "current" {}

locals {
  upload_prefix = "uploads/"
  upload_suffix = "/inventory_frame.csv"
}

resource "aws_s3_bucket" "uploads" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  cors_rule {
    allowed_origins = sort(tolist(var.frontend_origins))
    allowed_methods = ["PUT"]
    allowed_headers = ["Content-Type", "If-None-Match"]
    expose_headers  = ["ETag", "x-amz-version-id"]
    max_age_seconds = 300
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket     = aws_s3_bucket.uploads.id
  depends_on = [aws_s3_bucket_versioning.uploads]

  rule {
    id     = "expire-import-uploads"
    status = "Enabled"
    filter {
      prefix = local.upload_prefix
    }
    expiration {
      days = 7
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  rule {
    id     = "remove-expired-upload-markers"
    status = "Enabled"
    filter {
      prefix = local.upload_prefix
    }
    expiration {
      expired_object_delete_marker = true
    }
  }
}

data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "RequireTLS"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.uploads.arn, "${aws_s3_bucket.uploads.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid       = "RequireCreateOnlyUploads"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.uploads.arn}/${local.upload_prefix}*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "s3:if-none-match"
      values   = ["*"]
    }
  }
}

resource "aws_s3_bucket_policy" "uploads" {
  bucket     = aws_s3_bucket.uploads.id
  policy     = data.aws_iam_policy_document.bucket.json
  depends_on = [aws_s3_bucket_public_access_block.uploads]
}

resource "aws_sqs_queue" "dead_letters" {
  name                      = "${var.name_prefix}-inventory-import-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "uploads" {
  name                       = "${var.name_prefix}-inventory-import"
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = 120
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_letters.arn
    maxReceiveCount     = 5
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "dead_letters" {
  queue_url = aws_sqs_queue.dead_letters.url

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.uploads.arn]
  })
}

data "aws_iam_policy_document" "notifications" {
  statement {
    sid       = "AllowUploadBucket"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.uploads.arn]

    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_s3_bucket.uploads.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sqs_queue_policy" "uploads" {
  queue_url = aws_sqs_queue.uploads.url
  policy    = data.aws_iam_policy_document.notifications.json
}

resource "aws_s3_bucket_notification" "uploads" {
  bucket     = aws_s3_bucket.uploads.id
  depends_on = [aws_sqs_queue_policy.uploads, aws_s3_bucket_versioning.uploads]

  queue {
    queue_arn     = aws_sqs_queue.uploads.arn
    events        = ["s3:ObjectCreated:Put"]
    filter_prefix = local.upload_prefix
    filter_suffix = local.upload_suffix
  }
}

data "aws_iam_policy_document" "application" {
  statement {
    sid       = "AccessImportObjects"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion"]
    resources = ["${aws_s3_bucket.uploads.arn}/${local.upload_prefix}*${local.upload_suffix}"]
  }

  statement {
    sid = "ConsumeImportQueues"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.uploads.arn, aws_sqs_queue.dead_letters.arn]
  }
}

resource "aws_iam_policy" "application" {
  name   = "${var.name_prefix}-inventory-import"
  policy = data.aws_iam_policy_document.application.json
}

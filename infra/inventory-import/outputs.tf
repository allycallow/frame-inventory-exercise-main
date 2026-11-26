output "bucket_name" {
  value = aws_s3_bucket.uploads.id
}

output "queue_url" {
  value = aws_sqs_queue.uploads.url
}

output "dead_letter_queue_url" {
  value = aws_sqs_queue.dead_letters.url
}

output "application_policy_arn" {
  value = aws_iam_policy.application.arn
}

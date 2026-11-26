variable "aws_region" {
  description = "AWS Region for the upload bucket and both queues."
  type        = string
}

variable "bucket_name" {
  description = "Globally unique name for the dedicated upload bucket."
  type        = string
}

variable "name_prefix" {
  description = "Environment-specific prefix for queues and the application policy."
  type        = string

  validation {
    condition     = can(regex("^[a-zA-Z0-9_-]{1,59}$", var.name_prefix))
    error_message = "Use 1–59 ASCII letters, digits, hyphens, or underscores."
  }
}

variable "frontend_origins" {
  description = "Exact browser origins allowed to issue upload PUTs."
  type        = set(string)

  validation {
    condition = length(var.frontend_origins) > 0 && alltrue([
      for origin in var.frontend_origins : can(regex("^https?://[^/*?#[:space:]]+$", origin))
    ])
    error_message = "Provide at least one exact HTTP(S) origin without a path or wildcard."
  }
}

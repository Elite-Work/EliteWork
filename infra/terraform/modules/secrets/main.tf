terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# ------------------------------------------------------------------------------
# AWS Secrets Manager — Admin Secret Key
#
# Stores the ADMIN_SECRET_KEY (Stellar Soroban signing key) used by backend
# admin operations. The secret value is NEVER written to Terraform state outputs,
# Git, Kubernetes manifests, or logs.
# ------------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "admin_secret_key" {
  name        = "${var.project_name}-${var.environment}-admin-secret-key"
  description = "Stellar Soroban signing key for admin operations (${var.environment})"

  tags = {
    Name        = "${var.project_name}-admin-secret-key"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# The actual secret value is injected at rotation time or via the AWS console/CLI.
# Terraform creates the secret resource but does NOT store the value.
# Use: aws secretsmanager put-secret-value --secret-id <ARN> --secret-string <VALUE>

resource "aws_secretsmanager_secret_version" "admin_secret_key" {
  secret_id = aws_secretsmanager_secret.admin_secret_key.id

  # Initial placeholder — replaced immediately after first apply via CLI.
  # This ensures the secret exists before the backend pods start.
  secret_string = "REPLACE_WITH_ADMIN_SECRET_KEY"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# IAM policy granting the EKS node role read access to this secret
data "aws_iam_policy_document" "admin_secret_key_read" {
  statement {
    sid    = "AllowSecretRead"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [
      aws_secretsmanager_secret.admin_secret_key.arn,
    ]
  }
}

resource "aws_iam_policy" "admin_secret_key_read" {
  name        = "${var.project_name}-${var.environment}-admin-secret-key-read"
  description = "Allow backend pods to read ADMIN_SECRET_KEY from Secrets Manager"
  policy      = data.aws_iam_policy_document.admin_secret_key_read.json

  tags = {
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "admin_secret_key_read" {
  role       = var.eks_node_role_name
  policy_arn = aws_iam_policy.admin_secret_key_read.arn
}

# --- Variables ---

variable "project_name" {
  description = "Project name"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,29}$", var.project_name))
    error_message = "project_name must be 2-30 characters of lowercase letters, digits, or hyphens, and start with a letter."
  }
}

variable "environment" {
  description = "Environment name (dev, staging, or production)"
  type        = string

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "environment must be one of: dev, staging, production."
  }
}

variable "eks_node_role_name" {
  description = "IAM role name for EKS worker nodes (to attach secret read policy)"
  type        = string
}

# --- Outputs ---

output "secret_arn" {
  description = "ARN of the Secrets Manager secret (use in K8s ExternalSecret or CSI driver)"
  value       = aws_secretsmanager_secret.admin_secret_key.arn
}

output "secret_name" {
  description = "Name of the Secrets Manager secret"
  value       = aws_secretsmanager_secret.admin_secret_key.name
}

output "secret_read_policy_arn" {
  description = "ARN of the IAM policy granting read access"
  value       = aws_iam_policy.admin_secret_key_read.arn
}

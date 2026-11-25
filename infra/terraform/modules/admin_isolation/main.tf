# Admin Isolation Module — VPC Security Group Policy for Internal Admin Access

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

variable "vpc_id" {
  description = "VPC ID"
  type        = string

  validation {
    condition     = can(regex("^vpc-[0-9a-f]+$", var.vpc_id))
    error_message = "vpc_id must be a VPC identifier such as vpc-0123456789abcdef0."
  }
}

variable "trusted_admin_cidrs" {
  description = "Trusted IP CIDR ranges permitted to reach admin endpoints"
  type        = list(string)
  default     = ["10.0.0.0/16", "172.16.0.0/12"]

  validation {
    condition     = length(var.trusted_admin_cidrs) > 0 && alltrue([for cidr in var.trusted_admin_cidrs : can(cidrhost(cidr, 0))])
    error_message = "trusted_admin_cidrs must contain at least one valid CIDR block."
  }
}

resource "aws_security_group" "admin_access_sg" {
  name        = "${var.project_name}-${var.environment}-admin-sg"
  description = "Restricts admin endpoints access to trusted management networks"
  vpc_id      = var.vpc_id

  ingress {
    description = "Allow HTTPS admin access from trusted internal networks"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.trusted_admin_cidrs
  }

  ingress {
    description = "Allow direct backend port access from management VPN"
    from_port   = 4000
    to_port     = 4000
    protocol    = "tcp"
    cidr_blocks = var.trusted_admin_cidrs
  }

  egress {
    description = "Allow outbound traffic to VPC"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-admin-sg"
    Environment = var.environment
    Policy      = "AdminEndpointIsolation"
  }
}

output "admin_security_group_id" {
  description = "ID of the admin isolation security group"
  value       = aws_security_group.admin_access_sg.id
}

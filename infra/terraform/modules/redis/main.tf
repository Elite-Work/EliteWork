terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_security_group" "this" {
  name_prefix = "${var.project_name}-redis-sg"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = var.port
    to_port     = var.port
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project_name}-redis-sg"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_elasticache_subnet_group" "this" {
  name        = "${var.project_name}-redis-subnet-group"
  subnet_ids  = var.subnet_ids
  description = "Redis subnet group for ${var.project_name}"

  tags = {
    Name        = "${var.project_name}-redis-subnet-group"
    Environment = var.environment
  }
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = "${var.project_name}-redis"
  description                = "${var.project_name} Redis cluster"
  node_type                  = var.node_type
  num_cache_clusters         = var.replica_count
  port                       = var.port
  engine                     = var.engine
  engine_version             = var.engine_version
  parameter_group_name       = var.parameter_group_name
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [aws_security_group.this.id]
  automatic_failover_enabled = var.automatic_failover_enabled
  multi_az_enabled           = var.multi_az_enabled
  at_rest_encryption_enabled = var.at_rest_encryption_enabled
  transit_encryption_enabled = var.transit_encryption_enabled
  auth_token                 = var.auth_token

  snapshot_retention_limit = var.snapshot_retention_limit
  snapshot_window          = var.snapshot_window

  tags = {
    Name        = "${var.project_name}-redis"
    Environment = var.environment
  }
}

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
}

variable "subnet_ids" {
  description = "Subnet IDs for Redis"
  type        = list(string)
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access Redis"
  type        = list(string)
  default     = []
}

variable "engine" {
  description = "Redis engine"
  type        = string
  default     = "redis"

  validation {
    condition     = var.engine == "redis"
    error_message = "engine must be redis; this module only supports ElastiCache for Redis."
  }
}

variable "engine_version" {
  description = "Redis engine version"
  type        = string
  default     = "7.0"

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+$", var.engine_version))
    error_message = "engine_version must be a major.minor version such as 7.0."
  }
}

variable "node_type" {
  description = "Cache node type"
  type        = string
  default     = "cache.t3.medium"

  validation {
    condition     = can(regex("^cache\\.[a-z0-9]+\\.[a-z0-9]+$", var.node_type))
    error_message = "node_type must be a valid ElastiCache node type such as cache.t3.medium."
  }
}

variable "port" {
  description = "Redis port"
  type        = number
  default     = 6379

  validation {
    condition     = var.port >= 1 && var.port <= 65535
    error_message = "port must be between 1 and 65535."
  }
}

variable "replica_count" {
  description = "Number of cache clusters"
  type        = number
  default     = 2

  validation {
    condition     = var.replica_count >= 1 && floor(var.replica_count) == var.replica_count && (!var.automatic_failover_enabled || var.replica_count >= 2)
    error_message = "replica_count must be a whole number of at least 1, and at least 2 when automatic_failover_enabled is true."
  }
}

variable "parameter_group_name" {
  description = "Parameter group name"
  type        = string
  default     = "default.redis7"

  validation {
    condition     = can(regex("^[a-zA-Z0-9][a-zA-Z0-9.-]{0,254}$", var.parameter_group_name))
    error_message = "parameter_group_name must be a valid ElastiCache parameter group name."
  }
}

variable "automatic_failover_enabled" {
  description = "Enable automatic failover"
  type        = bool
  default     = true
}

variable "multi_az_enabled" {
  description = "Enable Multi-AZ"
  type        = bool
  default     = true
}

variable "at_rest_encryption_enabled" {
  description = "Enable encryption at rest"
  type        = bool
  default     = true
}

variable "transit_encryption_enabled" {
  description = "Enable encryption in transit"
  type        = bool
  default     = true
}

variable "auth_token" {
  description = "Auth token for Redis"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.auth_token) >= 16 && length(var.auth_token) <= 128
    error_message = "auth_token must be between 16 and 128 characters, as required by ElastiCache."
  }
}

variable "snapshot_retention_limit" {
  description = "Snapshot retention limit in days"
  type        = number
  default     = 5

  validation {
    condition     = var.snapshot_retention_limit >= 0 && var.snapshot_retention_limit <= 35
    error_message = "snapshot_retention_limit must be between 0 and 35 days."
  }
}

variable "snapshot_window" {
  description = "Snapshot window (UTC, HH:MM-HH:MM)"
  type        = string
  default     = "02:00-03:00"

  validation {
    condition     = can(regex("^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$", var.snapshot_window))
    error_message = "snapshot_window must use the HH:MM-HH:MM UTC format, for example 02:00-03:00."
  }
}

output "primary_endpoint" {
  description = "Redis primary endpoint"
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "reader_endpoint" {
  description = "Redis reader endpoint"
  value       = aws_elasticache_replication_group.this.reader_endpoint_address
}

output "replication_group_id" {
  description = "Redis replication group ID"
  value       = aws_elasticache_replication_group.this.id
}

output "port" {
  description = "Redis port"
  value       = aws_elasticache_replication_group.this.port
}

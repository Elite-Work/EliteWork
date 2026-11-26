terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.project_name}-rds-subnet-group"
  subnet_ids = var.subnet_ids

  tags = {
    Name        = "${var.project_name}-rds-subnet-group"
    Environment = var.environment
  }
}

resource "aws_security_group" "this" {
  name_prefix = "${var.project_name}-rds-sg"
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
    Name        = "${var.project_name}-rds-sg"
    Environment = var.environment
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_rds_cluster" "this" {
  cluster_identifier      = "${var.project_name}-rds-cluster"
  engine                  = var.engine
  engine_version          = var.engine_version
  database_name           = var.database_name
  master_username         = var.master_username
  master_password         = var.master_password
  backup_retention_period = var.backup_retention_period
  preferred_backup_window = var.preferred_backup_window
  db_subnet_group_name    = aws_db_subnet_group.this.name
  vpc_security_group_ids  = [aws_security_group.this.id]
  skip_final_snapshot     = var.skip_final_snapshot
  deletion_protection     = var.deletion_protection

  tags = {
    Name        = "${var.project_name}-rds-cluster"
    Environment = var.environment
  }
}

resource "aws_rds_cluster_instance" "this" {
  count              = var.replica_count
  identifier         = "${var.project_name}-rds-instance-${count.index + 1}"
  cluster_identifier = aws_rds_cluster.this.id
  instance_class     = var.instance_class
  engine             = var.engine
  engine_version     = var.engine_version

  tags = {
    Name        = "${var.project_name}-rds-instance-${count.index + 1}"
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
  description = "Subnet IDs for RDS"
  type        = list(string)
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access RDS"
  type        = list(string)
  default     = []
}

variable "engine" {
  description = "Database engine (aurora-postgresql or aurora-mysql)"
  type        = string
  default     = "aurora-postgresql"

  validation {
    condition     = contains(["aurora-postgresql", "aurora-mysql"], var.engine)
    error_message = "engine must be either aurora-postgresql or aurora-mysql."
  }
}

variable "engine_version" {
  description = "Database engine version"
  type        = string
  default     = "15.4"

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+$", var.engine_version))
    error_message = "engine_version must be a major.minor version such as 15.4."
  }
}

variable "instance_class" {
  description = "Instance class"
  type        = string
  default     = "db.t3.medium"

  validation {
    condition     = can(regex("^db\\.[a-z0-9]+\\.[a-z0-9]+$", var.instance_class))
    error_message = "instance_class must be a valid RDS instance class such as db.t3.medium."
  }
}

variable "database_name" {
  description = "Database name"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9_]{0,62}$", var.database_name))
    error_message = "database_name must start with a lowercase letter and contain only lowercase letters, digits, or underscores (max 63 characters)."
  }
}

variable "master_username" {
  description = "Master username"
  type        = string

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,62}$", var.master_username))
    error_message = "master_username must start with a letter and contain only letters, digits, or underscores (max 63 characters)."
  }
}

variable "master_password" {
  description = "Master password"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.master_password) >= 8 && length(var.master_password) <= 128
    error_message = "master_password must be between 8 and 128 characters."
  }
}

variable "port" {
  description = "Database port"
  type        = number
  default     = 5432

  validation {
    condition     = var.port >= 1 && var.port <= 65535
    error_message = "port must be between 1 and 65535."
  }
}

variable "replica_count" {
  description = "Number of replica instances"
  type        = number
  default     = 1

  validation {
    condition     = var.replica_count >= 1 && floor(var.replica_count) == var.replica_count
    error_message = "replica_count must be a whole number of at least 1."
  }
}

variable "backup_retention_period" {
  description = "Backup retention period in days"
  type        = number
  default     = 7

  validation {
    condition     = var.backup_retention_period >= 1 && var.backup_retention_period <= 35
    error_message = "backup_retention_period must be between 1 and 35 days (the Aurora maximum)."
  }
}

variable "preferred_backup_window" {
  description = "Preferred backup window (UTC, HH:MM-HH:MM)"
  type        = string
  default     = "03:00-04:00"

  validation {
    condition     = can(regex("^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$", var.preferred_backup_window))
    error_message = "preferred_backup_window must use the HH:MM-HH:MM UTC format, for example 03:00-04:00."
  }
}

variable "skip_final_snapshot" {
  description = "Skip final snapshot on deletion"
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Enable deletion protection"
  type        = bool
  default     = true
}

output "cluster_endpoint" {
  description = "RDS cluster endpoint"
  value       = aws_rds_cluster.this.endpoint
}

output "cluster_reader_endpoint" {
  description = "RDS cluster reader endpoint"
  value       = aws_rds_cluster.this.reader_endpoint
}

output "cluster_id" {
  description = "RDS cluster ID"
  value       = aws_rds_cluster.this.id
}

output "instance_ids" {
  description = "RDS instance IDs"
  value       = aws_rds_cluster_instance.this[*].id
}

terraform {
  backend "s3" {
    bucket         = "amana-terraform-state-dev"
    key            = "infra/terraform/dev/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "amana-terraform-locks-dev"
  }
}

provider "aws" {
  region = var.region
}

module "vpc" {
  source = "../../modules/vpc"

  project_name         = "amana"
  environment           = "dev"
  region               = var.region
  vpc_cidr             = "10.0.0.0/16"
  public_subnet_cidrs  = ["10.0.1.0/24", "10.0.2.0/24"]
  private_subnet_cidrs = ["10.0.10.0/24", "10.0.11.0/24"]
  availability_zones   = ["us-east-1a", "us-east-1b"]
  nat_gateway_count    = 1
}

module "rds" {
  source = "../../modules/rds"

  project_name          = "amana"
  environment            = "dev"
  vpc_id                = module.vpc.vpc_id
  subnet_ids            = module.vpc.private_subnet_ids
  allowed_cidr_blocks   = [module.vpc.vpc_cidr]
  engine                = "aurora-postgresql"
  engine_version        = "15.4"
  instance_class        = "db.t3.medium"
  database_name         = "amana_dev"
  master_username       = var.db_master_username
  master_password       = var.db_master_password
  port                  = 5432
  replica_count         = 1
  backup_retention_period = 7
  preferred_backup_window = "03:00-04:00"
  skip_final_snapshot   = true
  deletion_protection   = false
}

module "redis" {
  source = "../../modules/redis"

  project_name              = "amana"
  environment                = "dev"
  vpc_id                    = module.vpc.vpc_id
  subnet_ids                = module.vpc.private_subnet_ids
  allowed_cidr_blocks       = [module.vpc.vpc_cidr]
  engine                    = "redis"
  engine_version            = "7.0"
  node_type                 = "cache.t3.medium"
  port                      = 6379
  replica_count             = 2
  parameter_group_name      = "default.redis7"
  automatic_failover_enabled = true
  multi_az_enabled          = true
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                = var.redis_auth_token
  snapshot_retention_limit  = 5
  snapshot_window           = "02:00-03:00"
}

module "eks" {
  source = "../../modules/eks"

  project_name             = "amana"
  environment              = "dev"
  region                   = var.region
  vpc_id                   = module.vpc.vpc_id
  subnet_ids               = module.vpc.private_subnet_ids
  kubernetes_version       = "1.29"
  instance_types           = ["t3.medium"]
  desired_size             = 2
  max_size                 = 4
  min_size                 = 1
  node_labels              = {}
  endpoint_private_access  = true
  endpoint_public_access   = false
  public_access_cidrs      = []
  enabled_cluster_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
}

module "secrets" {
  source = "../../modules/secrets"

  project_name       = "amana"
  environment        = "dev"
  eks_node_role_name = module.eks.node_role_arn
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"

  validation {
    condition     = can(regex("^[a-z]{2}(-gov)?-[a-z]+-[0-9]$", var.region))
    error_message = "region must be a valid AWS region identifier such as us-east-1 or eu-west-2."
  }
}

variable "db_master_username" {
  description = "Database master username"
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,62}$", var.db_master_username))
    error_message = "db_master_username must start with a letter and contain only letters, digits, or underscores (max 63 characters)."
  }
}

variable "db_master_password" {
  description = "Database master password"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.db_master_password) >= 8 && length(var.db_master_password) <= 128
    error_message = "db_master_password must be between 8 and 128 characters."
  }
}

variable "redis_auth_token" {
  description = "Redis auth token"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.redis_auth_token) >= 16 && length(var.redis_auth_token) <= 128
    error_message = "redis_auth_token must be between 16 and 128 characters, as required by ElastiCache."
  }
}

output "rds_endpoint" {
  description = "RDS endpoint"
  value       = module.rds.cluster_endpoint
}

output "redis_endpoint" {
  description = "Redis endpoint"
  value       = module.redis.primary_endpoint
}

output "eks_cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_id
}

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

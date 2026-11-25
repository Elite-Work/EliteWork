terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name        = "${var.project_name}-vpc"
    Environment = var.environment
  }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = {
    Name        = "${var.project_name}-igw"
    Environment = var.environment
  }
}

resource "aws_subnet" "public" {
  count                   = length(var.public_subnet_cidrs)
  vpc_id                  = aws_vpc.this.id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name        = "${var.project_name}-public-subnet-${count.index + 1}"
    Environment = var.environment
    Type        = "public"
  }
}

resource "aws_subnet" "private" {
  count             = length(var.private_subnet_cidrs)
  vpc_id            = aws_vpc.this.id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name        = "${var.project_name}-private-subnet-${count.index + 1}"
    Environment = var.environment
    Type        = "private"
  }
}

resource "aws_eip" "nat" {
  count  = var.nat_gateway_count
  domain = "vpc"

  tags = {
    Name        = "${var.project_name}-eip-${count.index + 1}"
    Environment = var.environment
  }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_nat_gateway" "this" {
  count         = var.nat_gateway_count
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = {
    Name        = "${var.project_name}-nat-${count.index + 1}"
    Environment = var.environment
  }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = {
    Name        = "${var.project_name}-public-rt"
    Environment = var.environment
  }
}

resource "aws_route_table" "private" {
  count  = var.nat_gateway_count
  vpc_id = aws_vpc.this.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[count.index].id
  }

  tags = {
    Name        = "${var.project_name}-private-rt-${count.index + 1}"
    Environment = var.environment
  }
}

resource "aws_route_table_association" "public" {
  count          = length(var.public_subnet_cidrs)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = length(var.private_subnet_cidrs)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index % var.nat_gateway_count].id
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

variable "region" {
  description = "AWS region (for example us-east-1)"
  type        = string

  validation {
    condition     = can(regex("^[a-z]{2}(-gov)?-[a-z]+-[0-9]$", var.region))
    error_message = "region must be a valid AWS region identifier such as us-east-1 or eu-west-2."
  }
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be a valid IPv4 or IPv6 CIDR block, for example 10.0.0.0/16."
  }
}

variable "public_subnet_cidrs" {
  description = "List of public subnet CIDR blocks"
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_cidrs) > 0 && alltrue([for cidr in var.public_subnet_cidrs : can(cidrhost(cidr, 0))])
    error_message = "public_subnet_cidrs must contain at least one valid CIDR block."
  }
}

variable "private_subnet_cidrs" {
  description = "List of private subnet CIDR blocks"
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_cidrs) > 0 && alltrue([for cidr in var.private_subnet_cidrs : can(cidrhost(cidr, 0))])
    error_message = "private_subnet_cidrs must contain at least one valid CIDR block."
  }
}

variable "availability_zones" {
  description = "List of availability zones, one per subnet"
  type        = list(string)

  validation {
    condition     = length(var.availability_zones) >= max(length(var.public_subnet_cidrs), length(var.private_subnet_cidrs)) && alltrue([for az in var.availability_zones : can(regex("^[a-z]{2}(-gov)?-[a-z]+-[0-9][a-z]$", az))])
    error_message = "availability_zones must name valid AZs and provide at least one entry per public and private subnet."
  }
}

variable "nat_gateway_count" {
  description = "Number of NAT gateways"
  type        = number
  default     = 1

  validation {
    condition     = var.nat_gateway_count >= 1 && var.nat_gateway_count <= length(var.public_subnet_cidrs)
    error_message = "nat_gateway_count must be between 1 and the number of public subnets."
  }
}

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.this.id
}

output "vpc_cidr" {
  description = "CIDR block of the VPC"
  value       = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = aws_subnet.private[*].id
}

output "nat_gateway_ids" {
  description = "NAT gateway IDs"
  value       = aws_nat_gateway.this[*].id
}

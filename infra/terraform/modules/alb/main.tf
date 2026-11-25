terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

locals {
  common_tags = merge(var.tags, {
    Name        = "${var.project_name}-${var.environment}-alb"
    Environment = var.environment
  })
}

resource "aws_security_group" "this" {
  name_prefix = "${var.project_name}-${var.environment}-alb-"
  description = "Ingress for the ${var.project_name} application load balancer"
  vpc_id      = var.vpc_id

  dynamic "ingress" {
    for_each = toset(var.allowed_cidr_blocks)

    content {
      description = "HTTP redirect"
      from_port   = 80
      to_port     = 80
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  dynamic "ingress" {
    for_each = toset(var.allowed_cidr_blocks)

    content {
      description = "HTTPS listener"
      from_port   = 443
      to_port     = 443
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

resource "aws_lb" "this" {
  name_prefix                = "alb-"
  internal                   = var.internal
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.this.id]
  subnets                    = var.subnet_ids
  enable_deletion_protection = var.deletion_protection

  tags = local.common_tags
}

resource "aws_lb_target_group" "this" {
  name_prefix = "tgt-"
  port        = var.target_port
  protocol    = var.target_protocol
  target_type = var.target_type
  vpc_id      = var.vpc_id

  health_check {
    enabled  = true
    path     = var.health_check_path
    protocol = var.target_protocol
    matcher  = "200-399"
  }

  tags = local.common_tags
}

resource "aws_lb_target_group_attachment" "this" {
  count = length(var.target_ids)

  target_group_arn = aws_lb_target_group.this.arn
  target_id        = var.target_ids[count.index]
  port             = var.target_port
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.certificate_arn
  ssl_policy        = var.ssl_policy

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
}

variable "project_name" {
  description = "Project name used in resource tags and security group naming."
  type        = string
}

variable "environment" {
  description = "Environment name applied to resource tags."
  type        = string
}

variable "vpc_id" {
  description = "VPC containing the ALB and its targets."
  type        = string
}

variable "subnet_ids" {
  description = "Subnets for the ALB; use at least two subnets in distinct Availability Zones."
  type        = list(string)

  validation {
    condition     = length(var.subnet_ids) >= 2
    error_message = "An Application Load Balancer requires at least two subnet IDs."
  }
}

variable "certificate_arn" {
  description = "ARN of an ACM certificate in the same region as the ALB."
  type        = string
}

variable "allowed_cidr_blocks" {
  description = "IPv4 CIDRs allowed to connect to the HTTP and HTTPS listeners."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "internal" {
  description = "Whether the ALB is internal rather than internet-facing."
  type        = bool
  default     = false
}

variable "target_ids" {
  description = "Instance IDs or IP addresses registered in the target group."
  type        = list(string)
  default     = []
}

variable "target_type" {
  description = "Target group registration type: instance or ip."
  type        = string
  default     = "ip"

  validation {
    condition     = contains(["instance", "ip"], var.target_type)
    error_message = "target_type must be either instance or ip."
  }
}

variable "target_port" {
  description = "Port used by the target group and its registered targets."
  type        = number
  default     = 4000
}

variable "target_protocol" {
  description = "Protocol from the ALB to targets. HTTPS re-encrypts traffic after ALB TLS termination."
  type        = string
  default     = "HTTP"

  validation {
    condition     = contains(["HTTP", "HTTPS"], var.target_protocol)
    error_message = "target_protocol must be HTTP or HTTPS."
  }
}

variable "health_check_path" {
  description = "HTTP(S) path checked on each registered target."
  type        = string
  default     = "/health/ready"
}

variable "ssl_policy" {
  description = "TLS security policy for the HTTPS listener."
  type        = string
  default     = "ELBSecurityPolicy-TLS13-1-2-2021-06"
}

variable "deletion_protection" {
  description = "Whether AWS should prevent deletion of the ALB."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Additional tags applied to ALB resources. Name and Environment are set by the module."
  type        = map(string)
  default     = {}
}

output "load_balancer_arn" {
  description = "ARN of the Application Load Balancer."
  value       = aws_lb.this.arn
}

output "load_balancer_dns_name" {
  description = "DNS name of the Application Load Balancer."
  value       = aws_lb.this.dns_name
}

output "load_balancer_zone_id" {
  description = "Canonical hosted zone ID for Route 53 alias records."
  value       = aws_lb.this.zone_id
}

output "target_group_arn" {
  description = "ARN of the default target group."
  value       = aws_lb_target_group.this.arn
}

output "security_group_id" {
  description = "Security group attached to the ALB."
  value       = aws_security_group.this.id
}

output "http_listener_arn" {
  description = "ARN of the HTTP-to-HTTPS redirect listener."
  value       = aws_lb_listener.http.arn
}

output "https_listener_arn" {
  description = "ARN of the HTTPS forwarding listener."
  value       = aws_lb_listener.https.arn
}

# Terraform `alb` Module

Creates an AWS Application Load Balancer (ALB), a security group, one target
group, and HTTP/HTTPS listeners. The HTTP listener redirects to HTTPS; the
HTTPS listener terminates TLS with an ACM certificate and forwards requests to
the target group.

## Overview

The module is a reusable edge component that accepts the VPC and subnet IDs
from the [`vpc`](../vpc/README.md) module. It does not create target compute
resources, register Kubernetes pods, or attach itself to an environment.
Callers supply target IDs or integrate target registration with their
orchestrator.

The current Kubernetes ingress is configured separately in
[`infra/k8s/ingress.yaml`](../../../../infra/k8s/ingress.yaml) and uses the
NGINX ingress class. This Terraform module is not wired into the dev, staging,
or production Terraform environments; adding it does not change deployed
traffic.

## Resources

| Resource | Type | Purpose |
|---|---|---|
| `aws_security_group.this` | `aws_security_group` | Allows inbound HTTP/HTTPS from `allowed_cidr_blocks`; permits outbound target traffic |
| `aws_lb.this` | `aws_lb` | Application Load Balancer attached to the supplied subnets |
| `aws_lb_target_group.this` | `aws_lb_target_group` | Default target group with configurable protocol, target type, port, and readiness path |
| `aws_lb_target_group_attachment.this` | `aws_lb_target_group_attachment` | Registers each supplied target ID, when `target_ids` is non-empty |
| `aws_lb_listener.http` | `aws_lb_listener` | Redirects HTTP port 80 to HTTPS port 443 |
| `aws_lb_listener.https` | `aws_lb_listener` | Terminates TLS using the supplied ACM certificate and forwards to the default target group |

The ALB, target group, and security group are tagged with `Name` and
`Environment`, plus any entries in `tags`.

## Inputs

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| `project_name` | `string` | — | yes | Project name used for resource tags and security group naming |
| `environment` | `string` | — | yes | Environment name applied to resource tags |
| `vpc_id` | `string` | — | yes | VPC containing the ALB and targets |
| `subnet_ids` | `list(string)` | — | yes | At least two subnets in distinct Availability Zones |
| `certificate_arn` | `string` | — | yes | ACM certificate ARN in the ALB's region |
| `allowed_cidr_blocks` | `list(string)` | `["0.0.0.0/0"]` | no | IPv4 sources allowed to connect to ports 80 and 443 |
| `internal` | `bool` | `false` | no | Whether the ALB is internal or internet-facing |
| `target_ids` | `list(string)` | `[]` | no | Instance IDs or IP addresses registered in the target group |
| `target_type` | `string` | `"ip"` | no | Target registration mode: `ip` or `instance` |
| `target_port` | `number` | `4000` | no | Target group and target port |
| `target_protocol` | `string` | `"HTTP"` | no | Protocol from ALB to target: `HTTP` or `HTTPS` |
| `health_check_path` | `string` | `"/health/ready"` | no | Readiness path checked on registered targets |
| `ssl_policy` | `string` | `"ELBSecurityPolicy-TLS13-1-2-2021-06"` | no | TLS policy for the HTTPS listener |
| `deletion_protection` | `bool` | `true` | no | Whether AWS blocks deletion of the ALB |
| `tags` | `map(string)` | `{}` | no | Additional resource tags; module-controlled `Name` and `Environment` take precedence |

## Outputs

| Name | Type | Description |
|---|---|---|
| `load_balancer_arn` | `string` | ALB ARN |
| `load_balancer_dns_name` | `string` | ALB DNS name for alias/CNAME configuration |
| `load_balancer_zone_id` | `string` | Canonical hosted zone ID for a Route 53 alias |
| `target_group_arn` | `string` | Default target group ARN |
| `security_group_id` | `string` | ALB security group ID |
| `http_listener_arn` | `string` | HTTP redirect listener ARN |
| `https_listener_arn` | `string` | HTTPS forwarding listener ARN |

## Usage

```hcl
module "alb" {
  source = "../../modules/alb"

  project_name        = "amana"
  environment         = "staging"
  vpc_id              = module.vpc.vpc_id
  subnet_ids          = module.vpc.public_subnet_ids
  certificate_arn     = var.alb_certificate_arn
  allowed_cidr_blocks = ["0.0.0.0/0"]

  target_type          = "ip"
  target_ids           = var.backend_target_ips
  target_port          = 4000
  health_check_path    = "/health/ready"
  deletion_protection = true
}
```

The caller must ensure target IDs are valid for the configured target type,
remain current, and accept traffic from the ALB security group on
`target_port`. When using EKS, do not register ephemeral pod IPs as static
Terraform inputs; use the AWS Load Balancer Controller or another supported
target-registration integration.

## Listener rules and TLS termination

- The module creates a default HTTPS forwarding action and an HTTP-to-HTTPS
  redirect. It does not define host- or path-specific listener rules. Add
  `aws_lb_listener_rule` resources in the caller when separate hosts or paths
  need distinct target groups; keep rule priorities unique on each listener.
- TLS terminates at the ALB using the ACM certificate. HTTP is redirected to
  HTTPS, and the default target group uses HTTP inside the VPC.
- Set `target_protocol = "HTTPS"` when the target also requires encrypted
  transport. This re-encrypts traffic between the ALB and the target; it is
  not TLS pass-through, and the ALB does not validate target certificates. If
  end-to-end TLS pass-through is required, use a Network Load Balancer with a
  TCP listener instead of this ALB module.
- Use an internal ALB and restricted `allowed_cidr_blocks` for private
  services. The default allows IPv4 internet ingress; do not use that default
  for administrative endpoints. See the
  [`admin_isolation` module](../admin_isolation/README.md) and
  [admin network isolation policy](../../../../docs/admin-network-isolation.md).

## Operational notes

- An ACM certificate must already exist in the same AWS region. Certificate
  validation and DNS records are managed by the caller.
- At least two subnets in distinct Availability Zones are required. Use public
  subnets for an internet-facing ALB and private subnets for an internal ALB.
- An empty `target_ids` list leaves the target group without registered
  targets; the listener exists, but health checks will not succeed until
  targets are registered.
- The security group allows IPv4 CIDRs only. Restrict ingress explicitly when
  the service should not be public, and separately configure the target
  security group to accept the ALB's traffic.
- Deletion protection defaults to enabled. Disable it explicitly and apply
  that change before destroying a production ALB.
- The module creates no Route 53 records, WAF rules, access logs, or
  environment wiring. Add and review those controls according to the service's
  operational requirements.

## Related

- [`../vpc/README.md`](../vpc/README.md) — provides the VPC and public/private subnet IDs
- [`../admin_isolation/README.md`](../admin_isolation/README.md) — network controls for administrative endpoints
- [`infra/k8s/ingress.yaml`](../../../../infra/k8s/ingress.yaml) — current Kubernetes NGINX ingress configuration

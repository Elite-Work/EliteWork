# Terraform `iam` Module

Manages IAM roles and policies for the EziAgric infrastructure. Follows least-privilege principles and provides secure role isolation for different service categories.

## Overview

The module creates IAM roles with scoped permissions for:
- Backend service execution
- Database access
- External service integration
- Administrative functions

Each role is designed for a specific purpose and follows the principle of least privilege — granting only the minimum permissions necessary for the role's function.

## Resources

| Resource | Type | Purpose |
|---|---|---|
| `iam_role.this` | `iam_role` | Main service role with assumed trust policy |
| `iam_policy.this` | `iam_policy` | Custom inline policy document |
| `iam_instance_profile.this` | `iam_instance_profile` | Profile for EC2/EKS instance attachment |

## Inputs

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| `role_name` | `string` | — | yes | Name prefix for the IAM role. Used as the `Name` tag. |
| `assume_role_policy` | `string` | — | yes | JSON trust policy document that specifies which entities can assume this role. |
| `managed_policy_arns` | `list(string)` | `[]` | no | List of managed policy ARNs to attach to the role. |
| `inline_policy_documents` | `map(string)` | `{}` | no | Map of inline policy names to JSON policy documents. |
| `tags` | `map(string)` | `{}` | no | Additional tags to apply to the role and instance profile. |

## Outputs

| Name | Type | Description |
|---|---|---|
| `role_arn` | `string` | ARN of the created IAM role. |
| `role_name` | `string` | Name of the created IAM role. |
| `instance_profile_arn` | `string` | ARN of the associated instance profile. |

## Usage

```hcl
module "iam_role" {
  source  = "./iam"
  role_name     = "amana-backend"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
  tags = {
    Environment = "dev"
    Project     = "amana"
  }
}
```

## Security Considerations

- **Least Privilege**: All policies are scoped to specific actions and resources. Avoid wildcard permissions where possible.
- **Role Separation**: Different services (backend, frontend, databases) use separate roles to limit blast radius.
- **Policy Review**: Regularly review attached policies using `aws iam list-attached-role-policies` and remove unused permissions.
- **Condition Keys**: Where supported, use condition keys (e.g., `aws:SourceIp`, `sts:ExternalId`) to further restrict role assumption.

## Related Modules

- [`../vpc/README.md`](../vpc/README.md) — for network-related IAM permissions
- [`../rds/README.md`](../rds/README.md) — for database access policies
- [`admin_isolation/README.md`](../../admin_isolation/README.md) — administrative role patterns

## Related Documentation

- [Secrets Policy & Rotation](./../../docs/secrets-policy.md) — how IAM roles interact with secret rotation
- [PII Encryption at Rest](./../../docs/pii-encryption.md) — IAM permissions for PII access
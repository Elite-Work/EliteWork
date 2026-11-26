# Terraform `s3` Module

Manages S3 buckets for the EziAgric infrastructure. Provides versioned, lifecycle-managed storage for artifacts, backups, and static assets.

## Overview

The module creates S3 buckets with the following features:
- **Versioning**: Enabled by default to prevent accidental deletion and provide audit trails
- **Lifecycle Rules**: Automatic transition and expiration of objects
- **Server Access Logging**: Optional logging of all bucket requests
- **Bucket Policy**: Configurable access control

Each bucket is named according to a deterministic convention and tagged for cost tracking and ownership.

## Resources

| Resource | Type | Purpose |
|---|---|---|
| `s3_bucket.this` | `s3_bucket` | Main data bucket |
| `s3_bucket_versioning.this` | `s3_bucket_versioning` | Versioning configuration |
| `s3_bucket_lifecycle_configuration.this` | `s3_bucket_lifecycle_configuration` | Lifecycle rules for object expiration |
| `s3_bucket_server_side_encryption_configuration.this` | `s3_bucket_server_side_encryption_configuration` | Default encryption at rest |

## Inputs

| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| `bucket_name` | `string` | — | yes | Unique bucket name. Must be globally unique across all of AWS. |
| `environment` | `string` | — | yes | Environment name (e.g. `dev`, `staging`, `prod`). Applied as the `Environment` tag. |
| `enable_versioning` | `bool` | `true` | no | Enable object versioning. Recommended for all buckets. |
| `enable_logging` | `bool` | `false` | no | Enable server access logging to a separate bucket. |
| `log_prefix` | `string` | `"log/"` | no | Prefix for log objects when logging is enabled. |
| `lifecycle_days` | `number` | `30` | no | Default transition/expiration period in days. |
| `acl` | `string` | `"private"` | no |Bucket ACL. Always use `private` and rely on bucket policies. |
| `tags` | `map(string)` | `{}` | no | Additional tags to apply to the bucket. |

## Bucket Naming Conventions

Bucket names follow the pattern: `<project>-<environment>-<resource>-<random_suffix>`

- **Project**: `amana` (EziAgric)
- **Environment**: `dev`, `staging`, `prod`
- **Resource**: Description of bucket purpose (e.g., `artifacts`, `backups`, `static-assets`)
- **Random Suffix**: 6-character alphanumeric suffix for global uniqueness

Example: `amana-dev-artifacts-a1b2c3`

## Lifecycle Rules

Default lifecycle configuration applies to all objects:

| Rule | Action | Days |
|---|---|---|
| `transition-to-cool` | Transition to Infrequent Access | 30 |
| `transition-to-archive` | Transition to Glacier | 90 |
| `expire` | Permanently delete | 365 |

These rules can be overridden by setting `lifecycle_days` to a custom value or by passing custom lifecycle policies via additional configuration.

## Usage

```hcl
module "s3_artifacts" {
  source  = "./s3"
  bucket_name = "amana-dev-artifacts"
  environment = "dev"
  enable_versioning = true
  lifecycle_days = 90
  tags = {
    Project = "amana"
    Purpose = "artifacts"
  }
}
```

## Security Considerations

- **Default Encryption**: All buckets have SSE-S3 (AES-256) enabled by default.
- **Block Public Access**: All buckets have public access blocks configured to prevent accidental exposure.
- **Bucket Policies**: Policies should follow least privilege and be regularly audited.
- **Logging**: Enable server access logging for buckets containing sensitive data.

## Related Modules

- [`../iam/README.md`](../../iam/README.md) — for bucket access policies
- [`../rds/README.md`](../../rds/README.md) — for database backups stored in S3

## Related Documentation

- [Secrets Policy & Rotation](./../../docs/secrets-policy.md) — how S3 interacts with secret management
- [Software Bill of Materials (SBOM)](./../../docs/sbom.md) — S3 artifacts in release pipelines
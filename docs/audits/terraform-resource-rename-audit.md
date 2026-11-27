# Terraform Resource Rename & `moved` Blocks Audit

Issue: Elite-Work/EliteWork#477  
Audit window: `2026-05-27` to `2026-11-27` (last 6 months, audited against `upstream/main` at `b30b7ba6`)  
Scope: All `.tf` / `.tf.json` / `.tofu` files across `infra/terraform/`

## Summary

**No Terraform resource renames, module renames, cross-module resource moves, or `count`/`for_each` state-index migrations occurred in the git log over the last 6 months.** Because all Terraform configuration history begins within this window (`78aa5b0a` on `2026-06-29`) and every subsequent `.tf` change was strictly additive, documentation/validation-only, or an invalid-argument fix, **zero `moved` blocks are missing or required**.

## Commit History Audited

Every commit touching `*.tf` files in `upstream/main` was inspected in full:

| Commit | Date | Summary | `.tf` Changes Observed | Resource Rename? |
|---|---|---|---|---|
| `78aa5b0a` | `2026-06-29` | Initial Terraform cloud provisioning modules | Created `environments/{dev,staging}/main.tf` and `modules/{vpc,rds,redis,eks}/main.tf` | No (initial creation) |
| `a2afb805` | `2026-08-24` | Admin endpoint network isolation | Created `modules/admin_isolation/main.tf`; added `module "admin_isolation"` to `environments/staging/main.tf` | No (additive) |
| `7c214008` | `2026-08-25` | Terraform management for admin secret | Created `modules/secrets/main.tf`; added `module "secrets"` to `environments/{dev,staging}/main.tf` | No (additive) |
| `39aa088d` | `2026-08-25` | Merge upstream into admin infra policies | Combined `module "admin_isolation"` and `module "secrets"` in `environments/staging/main.tf` | No (merge) |
| `c5774cda` | `2026-10-19` | Validate Terraform tree against AWS provider v5 | Added `output "vpc_cidr"` in `modules/vpc/main.tf`; updated `aws_elasticache_replication_group.this` arguments in `modules/redis/main.tf` (`replication_group_description` → `description`, `number_cache_clusters` → `num_cache_clusters`); aligned whitespace on `aws_eip.nat` | No (see note below) |
| `14d1512f` | `2026-10-19` | Add production environment | Created `environments/production/main.tf` | No (additive) |
| `8e62e111` | `2026-11-24` | Add ALB module and infra guides | Created `modules/alb/main.tf` and `modules/alb/README.md` | No (initial creation) |
| `8fb3eccf` | `2026-11-25` | Validate Terraform inputs | Added `validation {}` blocks, updated variable `description` strings, and aligned `vpc_security_group_ids` whitespace in `modules/rds/main.tf` | No (input validation only) |

> [!NOTE]
> **Why `c5774cda` does not require a `moved` block:**  
> In `infra/terraform/modules/redis/main.tf`, `replication_group_description` and `number_cache_clusters` were invalid pre-v5 attribute names inside `resource "aws_elasticache_replication_group" "this"` that `hashicorp/aws ~> 5.0` rejected during validation. Renaming them to `description` and `num_cache_clusters` corrected the resource arguments without changing the Terraform resource address (`aws_elasticache_replication_group.this`) or its `replication_group_id` (`"${var.project_name}-redis"`). Terraform `moved` blocks only remap state addresses (`resource`, `module`, or `count`/`for_each` instance keys).

## Resource & Module Address Inventory

All 10 `.tf` files in `infra/terraform/` were verified to retain their original resource and module addresses:

- **Environments** (`environments/{dev,staging,production}/main.tf`):
  - `module.vpc`, `module.rds`, `module.redis`, `module.eks` (unchanged since introduction)
  - `module.admin_isolation` (`staging` since `a2afb805`, `production` since `14d1512f`)
  - `module.secrets` (`dev`/`staging` since `7c214008`, `production` since `14d1512f`)
- **`modules/vpc/main.tf`**: `aws_vpc.this`, `aws_internet_gateway.this`, `aws_subnet.public` (`count`), `aws_subnet.private` (`count`), `aws_eip.nat` (`count`), `aws_nat_gateway.this` (`count`), `aws_route_table.public`, `aws_route_table.private` (`count`), `aws_route_table_association.public` (`count`), `aws_route_table_association.private` (`count`).
- **`modules/rds/main.tf`**: `aws_db_subnet_group.this`, `aws_security_group.this`, `aws_rds_cluster.this`, `aws_rds_cluster_instance.this` (`count`).
- **`modules/redis/main.tf`**: `aws_security_group.this`, `aws_elasticache_subnet_group.this`, `aws_elasticache_replication_group.this`.
- **`modules/eks/main.tf`**: `aws_iam_role.cluster`, `aws_iam_role_policy_attachment.cluster_amazon_eks_cluster_policy`, `aws_iam_role_policy_attachment.cluster_amazon_eks_vpc_resource_controller`, `aws_iam_role.node`, `aws_iam_role_policy_attachment.node_amazon_eks_worker_node_policy`, `aws_iam_role_policy_attachment.node_amazon_eks_cni_policy`, `aws_iam_role_policy_attachment.node_amazon_ec2_container_registry_readonly`, `aws_security_group.cluster`, `aws_security_group.node`, `aws_security_group_rule.cluster_ingress_node`, `aws_eks_cluster.this`, `aws_eks_node_group.this`.
- **`modules/admin_isolation/main.tf`**: `aws_security_group.admin_access_sg`.
- **`modules/secrets/main.tf`**: `aws_secretsmanager_secret.admin_secret_key`, `aws_secretsmanager_secret_version.admin_secret_key`, `aws_iam_policy.admin_secret_key_read`, `aws_iam_role_policy_attachment.admin_secret_key_read`.
- **`modules/alb/main.tf`**: `aws_security_group.this`, `aws_lb.this`, `aws_lb_target_group.this`, `aws_lb_target_group_attachment.this` (`count`), `aws_lb_listener.http`, `aws_lb_listener.https`.
- **`modules/iam/README.md` & `modules/s3/README.md`**: Documentation-only modules (no `.tf` files).

## Policy for Future Refactors

Renaming a `resource` or `module` label, relocating a resource into or out of a module, or converting between `count` and `for_each` changes its Terraform state address. Without a `moved` block, Terraform treats the old address as destroyed and the new address as created, which causes downtime or data loss for stateful resources (RDS, ElastiCache, EKS, Secrets Manager, VPC).

Whenever any future PR refactors a resource or module address:

1. Add a `moved` block in the `.tf` file alongside the new declaration:

   ```hcl
   moved {
     from = aws_security_group.old_name
     to   = aws_security_group.new_name
   }
   ```

2. Verify with `terraform plan` that the plan reports resources as **moved** rather than **destroy and recreate**.
3. Keep `moved` blocks in place until every live environment state (`dev`, `staging`, `production`) has been applied.

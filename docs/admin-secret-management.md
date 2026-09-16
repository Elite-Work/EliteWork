# ADMIN_SECRET_KEY Management

This document describes how `ADMIN_SECRET_KEY` is provisioned, consumed, and rotated
in the EliteWork backend infrastructure.

## Overview

`ADMIN_SECRET_KEY` is the Stellar Soroban **signing key** (private/secret key) used by
backend admin operations such as contract maintenance and stream termination. It is
**never** used for authentication — admin identity is determined by `ADMIN_STELLAR_PUBKEYS`.

The key must be kept secret at all times. It must never appear in:

- Git commits, pull requests, or CI logs
- Kubernetes ConfigMaps or plain-text manifests
- Terraform outputs or state files (beyond the resource ARN)
- Application logs or error messages
- Test fixtures (use `test-admin-secret-key-value` instead)

## Provisioning

### 1. Create the secret in AWS Secrets Manager

Terraform creates the Secrets Manager resource:

```bash
cd infra/terraform/environments/<env>
terraform apply
```

This creates the secret container but sets a placeholder value. Inject the real value:

```bash
aws secretsmanager put-secret-value \
  --secret-id amana-<env>-admin-secret-key \
  --secret-string "S<your-56-char-base32-secret-key>"
```

### 2. Sync to Kubernetes

The K8s Secret `amana-secrets` must contain the `ADMIN_SECRET_KEY` key. In production,
use one of:

- **External Secrets Operator**: Create an `ExternalSecret` CR that pulls from AWS
  Secrets Manager and writes to the `amana-secrets` K8s Secret.
- **AWS Secrets Store CSI Driver**: Mount the secret directly as a volume.
- **Manual sync** (development only):

```bash
VALUE=$(aws secretsmanager get-secret-value \
  --secret-id amana-<env>-admin-secret-key \
  --query SecretString --output text)

kubectl create secret generic amana-secrets \
  --from-literal=ADMIN_SECRET_KEY="$VALUE" \
  --dry-run=client -o yaml | kubectl apply -f -
```

### 3. Backend consumption

The `backend-deployment.yaml` mounts the secret as an environment variable:

```yaml
- name: ADMIN_SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: amana-secrets
      key: ADMIN_SECRET_KEY
```

The backend reads it via `env.ADMIN_SECRET_KEY` in `src/config/env.ts`.

### 4. Validate the manifest reference

Before/after applying manifests, confirm the Deployment's `secretKeyRef` actually
resolves to a provisioned key (catches drift such as a renamed Secret or a missing
`ADMIN_SECRET_KEY` entry):

```bash
./scripts/validate-k8s-admin-secret.sh
```

It checks the live cluster Secret when `kubectl` context is available, and falls back
to validating `infra/k8s/secrets.yaml` otherwise.

## Access Controls

| Who | Permission | How |
|-----|-----------|-----|
| EKS node IAM role | Read-only (`secretsmanager:GetSecretValue`) | Terraform IAM policy |
| Backend pods | Read via env var | K8s Secret `secretKeyRef` |
| CI/CD pipelines | None (tests use `test-admin-secret-key-value`) | Jest setup.ts |
| Developers | Read via `aws secretsmanager get-secret-value` | AWS CLI with IAM |

## Rotation

### Procedure

1. **Generate a new Stellar keypair** (never reuse compromised keys):

```bash
# Using Stellar CLI
stellar keys generate admin-new --network testnet
```

2. **Update the on-chain contract** to recognize the new signing address (if the key
   is used for Soroban contract authority).

3. **Inject the new value** into AWS Secrets Manager:

```bash
NEW_KEY=$(stellar keys show admin-new)
aws secretsmanager put-secret-value \
  --secret-id amana-<env>-admin-secret-key \
  --secret-string "$NEW_KEY"
```

4. **Restart backend pods** to pick up the new value:

```bash
kubectl rollout restart deployment/backend
```

5. **Verify health**:

```bash
curl https://<backend-url>/health | jq '.checks.adminSigningKey'
```

### Automated rotation (optional)

Configure AWS Secrets Manager automatic rotation with a Lambda function. Uncomment
the `aws_secretsmanager_secret_rotation` resource in
`infra/terraform/modules/secrets/main.tf` and provide a rotation Lambda ARN.

## Environment-specific configuration

| Environment | Secret name | K8s namespace |
|------------|-------------|---------------|
| dev | `amana-dev-admin-secret-key` | default |
| staging | `amana-staging-admin-secret-key` | default |
| production | `amana-production-admin-secret-key` | default |

## Troubleshooting

### Health check reports "ADMIN_SECRET_KEY is missing"

The secret is not mounted or the env var is not set. Check:

```bash
kubectl get secret amana-secrets -o jsonpath='{.data.ADMIN_SECRET_KEY}' | base64 -d
```

### Health check reports "Admin signing key check failed"

The value is not a valid Stellar secret key. Verify:

```bash
# The value should start with 'S' and be 56 base32 characters
echo "$ADMIN_SECRET_KEY" | wc -c  # should be 57 (56 chars + newline)
```

### Terraform apply fails with "AlreadyExists"

The secret was previously created. Import it:

```bash
terraform import aws_secretsmanager_secret.admin_secret_key \
  arn:aws:secretsmanager:<region>:<account>:secret:amana-<env>-admin-secret-key-xxxxxx
```

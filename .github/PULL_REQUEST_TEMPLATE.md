## Description
<!-- Provide a clear, detailed description of your changes -->

## Related Issues
<!-- List related issues below using 'Closes #issue-number' -->
- Closes #

## Type of Change
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Infrastructure / CI / Policy / Documentation update

## 🔒 Required CI Gates
<!--
All pull requests must pass the required stack-level CI gates before review.
See the Required PR CI Gates section in the README: ../README.md#-required-pr-ci-gates
and the Branch Protection Policy: ../docs/branch-protection-policy.md
-->
- [ ] **Frontend Required Gate**: `npm ci`, `npm run lint`, `npm run build`, `npm test` in `frontend/` (or skipped if no `frontend/` changes)
- [ ] **Backend Required Gate**: `npm ci`, `npm run build`, `npm test` in `backend/` (or skipped if no `backend/` changes)
- [ ] **Contracts Required Gate**: `cargo test` in `contracts/amana_escrow/` (or skipped if no `contracts/` changes)
- [ ] **Mobile Required Gate**: `npm ci`, `npm run type-check`, `npm run lint` in `mobile/` (or skipped if no `mobile/` changes)

> **Note**: Path-aware execution is enabled via `dorny/paths-filter`. Stacks with no changed files will report a skip-note and pass automatically. Reviewers will only review PRs once all applicable required gates are green. See [Required PR CI Gates](../README.md#-required-pr-ci-gates).

## PR Checklist
- [ ] Code builds and passes all unit & integration tests locally (`pnpm test` / `cargo test`)
- [ ] Documentation has been updated to reflect code changes
- [ ] **Admin Regression Tests**: If this PR modifies admin routes, controllers, middleware, or services, corresponding regression tests under `backend/src/__tests__/` have been added or updated (enforced by CI policy).
- [ ] **Secret Management**: No secrets, private keys, or credentials are hardcoded.
- [ ] **Network Isolation & Security**: Infrastructure changes preserve network isolation for admin endpoints.

## Contract Changes (complete if this PR modifies `contracts/`)
- [ ] **Security Review Checklist**: If this PR adds or modifies a contract admin function (e.g. `admin_clawback`), the [Contract E2E Security Review Checklist](../contracts/amana_escrow/docs/security-review-checklist.md) has been completed and attached or linked above.
- [ ] **Safe Upgrade Guide**: If this PR changes the contract ABI, storage layout, or introduces new events, the [Safe Upgrade Guide](../contracts/amana_escrow/docs/safe-upgrade-guide.md) release notes section has been updated.
- [ ] **Upgrade Simulation**: `./scripts/simulate-contract-upgrade.sh` has been run and exits 0.
- [ ] **Event Symbol Registry**: Any new contract event symbols are registered in [`upgrade-considerations.md`](../contracts/amana_escrow/docs/upgrade-considerations.md).

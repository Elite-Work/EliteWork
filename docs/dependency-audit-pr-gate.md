# Dependency Audit Pull-Request Gate

The repository runs the `Security Audit` workflow for pull requests that change dependency manifests, lockfiles, the audit workflow, or waiver policy. This keeps newly introduced high- and critical-severity dependency advisories visible before code is merged.

## What the gate checks

- Backend and frontend dependency trees are audited independently.
- Contract dependencies are checked with Cargo Audit.
- The waiver file is validated, including expiry dates, before a waiver can affect the result.
- The pull-request job is intentionally separate from the weekly report so release-blocking feedback is immediate.

## Interpreting a failure

A failed audit gate means the proposed dependency state requires review. Prefer upgrading or replacing the affected dependency. When a temporary exception is necessary, document why it is required, give it an expiry date, and update the waiver policy through normal review; do not weaken the audit threshold in a feature branch.

## Maintainer review checklist

1. Confirm the pull request changed a dependency or audit-policy input.
2. Review high- and critical-severity findings before approving.
3. Verify any waiver is narrowly scoped and unexpired.
4. Confirm a follow-up exists for every temporary exception.

The scheduled report remains useful for recurring visibility, while the pull-request gate protects the point where a new dependency is introduced.
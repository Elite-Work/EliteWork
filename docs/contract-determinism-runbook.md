# Contract Determinism Baseline Update Runbook

## Overview

This runbook documents the process for intentionally updating the baseline used by the contract test determinism checker (`scripts/verify-test-determinism.sh` and `.github/workflows/contract-determinism.yml`). The baseline is derived from `test_snapshots/` golden outputs and `Cargo.lock` hashes.

When to Update the Baseline

- A legitimate code change (e.g., new test, contract logic change) causes snapshot drift that is intentional and reviewed.
- The `Cargo.lock` hash changes, causing the CI cache to invalidate and triggering a full re-run.
- A new test is added that generates new snapshot files.

## Update Process

### 1. Regenerate Snapshots

Run the following from the repository root to regenerate all snapshots and remove orphans:

```bash
# From the repository root — regenerates all snapshots and removes orphans
bash scripts/cleanup-test-snapshots.sh

# Or regenerate without cleanup (just re-runs tests to overwrite snapshots)
UPDATE_SNAPSHOTS=1 cargo test --locked --package amana_escrow
```

### 2. Verify Snapshots

Inspect the generated snapshot diff to confirm changes are intentional:

```bash
git diff -- contracts/amana_escrow/test_snapshots/
```

### 3. Commit Updated Snapshots

Commit the snapshot changes in the same PR as the corresponding code change:

```bash
git add -A contracts/amana_escrow/test_snapshots/
git commit -m "chore: update test snapshots for <describe change>"
```

### 4. Update Contract Determinism Workflow Baseline (if needed)

If the `Cargo.lock` hash change is expected and you want to update the baseline hash used by `.github/workflows/contract-determinism.yml`:

```bash
# The new hash will be automatically picked up on the next CI run.
# If you need to pre-commit the new hash, update the workflow manually:

# 1. Run a local CI simulation to get the new hash:
cargo generate-lockfile --force-update

# 2. Update the workflow hash if needed (rare - usually handled by CI):
#   Edit .github/workflows/contract-determinism.yml:
#   - Change: key: contract-determinism-${{ runner.os }}-${{ hashFiles('contracts/Cargo.lock') }}
#   - This hash updates automatically on every push.
```

### 5. Update this Runbook

If the process itself changes, update this document and commit the change.

## Verification

After updating snapshots, run the full determinism check to ensure everything passes:

```bash
bash scripts/verify-test-determinism.sh
```

If the script exits with code 1, review the output for:
- Summary variations between runs (environment non-determinism)
- Changed golden output under `test_snapshots/`
- Missing or orphaned snapshots

## Related Links

- [Contract Test Determinism & Snapshot Hygiene](./test-determinism.md)
- [CI Contract Required Gate](.github/workflows/ci.yml)
- [Nightly Determinism Workflow](.github/workflows/contract-determinism.yml)
- [Scripts Unit Tests](package.json #test:scripts)
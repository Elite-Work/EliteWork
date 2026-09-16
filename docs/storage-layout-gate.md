# Storage layout compatibility gate

Tracking issue: [#196](https://github.com/Elite-Work/EliteWork/issues/196)

## What this protects

A Soroban contract upgrade replaces the code but keeps the storage. If a
`DataKey` variant's serialised form changes between versions, the upgraded
contract looks for its data under a key that no longer matches what is stored.
The old entries do not error — they are simply invisible. Trades, disputes, and
balances become unreachable on a live deployment.

`storage_golden_tests.rs` and `schema_version_tests.rs` already detect this.
What was missing was the discipline around them: nothing stopped a PR from
regenerating a golden value to make a failing test pass, and nothing tied a
layout change to a schema version bump. The gate supplies that.

## What the gate does

`scripts/check-storage-layout-gate.sh`, run by the **Storage Layout Required
Gate** job in `.github/workflows/ci.yml` on every contracts-path PR:

1. Runs `storage_golden_tests` and `schema_version_tests`, with
   `AMANA_REGEN_GOLDEN` explicitly unset — that variable turns the assertions
   into print statements, and a gate that honoured it could be bypassed by
   setting it.
2. Diffs the branch against its merge base for changes to
   `tests/storage_golden_tests.rs` or `test_snapshots/**`.
3. If either moved, requires the change to be **tagged intentional**.
4. If it is intentional, requires `CURRENT_SCHEMA_VERSION` to be bumped in the
   same PR.

Step 3 is the point of the whole thing. A golden test that fails is not a
problem to be made green; it is the check working. Regenerating the value is
sometimes right, but it must be a decision someone made on purpose and can be
seen to have made.

## Why a schema bump is required

A layout change without a version bump leaves deployed instances with no way to
tell which layout their storage uses. `get_schema_version()` is what a migration
branches on. Changing the layout while leaving the version at its old value
means the migration cannot distinguish "old layout, needs migrating" from "new
layout, already fine" — and running a migration twice is usually worse than not
running it.

## Refreshing snapshots safely

Only when you have concluded the layout change is correct and necessary.

**1. Confirm the change is actually needed.** Most golden failures are
accidents: a `DataKey` variant reordered, renamed, or inserted mid-enum. Fix the
code instead.

Appending a new variant to the **end** of `DataKey` does not change the encoding
of existing variants — Soroban keys `contracttype` enum variants by name, not by
position. This is why `SchemaVersion` and every variant after it were appended
rather than inserted, and why appending is the safe way to add storage.

**2. Regenerate the golden values.**

```bash
cd contracts/amana_escrow
AMANA_REGEN_GOLDEN=1 cargo test --test storage_golden_tests 2>&1 | grep GOLDEN
```

Paste the printed values into `storage_golden_tests.rs`. Never set this variable
in CI.

**3. Regenerate the stored snapshots.**

```bash
cd contracts/amana_escrow
rm -rf test_snapshots
cargo test --locked
```

The harness rewrites `test_snapshots/**` on the next run.

**4. Bump the schema version.** Increment `CURRENT_SCHEMA_VERSION` in
`contracts/amana_escrow/src/lib.rs` and update `schema_version_tests.rs` to
match.

**5. Write the migration.** A version bump without a migration only records that
storage moved; it does not move it. Add the migration path alongside the
existing ones in `src/tests/migration_tests.rs`.

**6. Tag the PR intentional**, using any one of:

- the `storage-layout-change` label, or
- `[storage-layout]` in the PR title or body, or
- `[storage-layout]` in a commit message on the branch.

The commit-message form lets you run the same gate locally:

```bash
./scripts/check-storage-layout-gate.sh origin/main
```

**7. Say what moved in the PR description** — which variants, why, and what a
deployed instance experiences during the migration. The label makes the gate
pass; the description is what a reviewer actually needs.

## Reviewing a tagged layout change

The gate confirms the change was declared, not that it is correct. A reviewer
should check:

- Was a variant reordered, renamed, or inserted mid-enum where appending would
  have worked?
- Does every changed golden value correspond to a variant the PR actually
  touches? An unexplained diff usually means something moved that nobody
  intended to move.
- Is there a migration, and is it reversible?
- Does `schema_version_tests.rs` pin the new version?

## Making the check required

The workflow job must also be marked required in branch protection — CI alone
does not block a merge:

Settings → Branches → branch protection rule for `main` → **Require status
checks to pass before merging** → add **Storage Layout Required Gate**.

Until that is done the gate reports failures without preventing a merge.

## Skip behaviour

On PRs that touch no contract paths the job runs its skip note and reports
success, matching the convention the other required gates in `ci.yml` use. A
required check that never reports on unrelated PRs would block every one of
them.

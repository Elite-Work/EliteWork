# Staging Synthetic Probes

Continuous synthetic execution of the core escrow journey against staging,
so breakage is caught by an automated probe within the hour instead of by a
human noticing staging is broken.

## 1. What is probed

`backend/scripts/staging-synthetic-probe.ts` runs the full happy-path
journey end to end on Stellar testnet:

1. **Auth** — buyer challenge/verify (`POST /auth/challenge`, `POST /auth/verify`)
2. **Create** — `POST /trades`
3. **Deposit** — build the deposit transaction (`POST /trades/:id/deposit`),
   sign it with the probe's testnet keypair, and submit it directly to the
   Soroban RPC endpoint
4. **Status poll** — `GET /trades/:id` until the trade reaches `FUNDED`
5. **Confirm** — seller confirms delivery (`POST /trades/:id/confirm`)
6. **Release** — buyer releases funds (`POST /trades/:id/release`)

Each step is timed and recorded independently, so a failure names the exact
step that broke rather than just "the probe failed."

## 2. Schedule and execution

Runs hourly in staging via
[`.github/workflows/synthetic-probes.yml`](../.github/workflows/synthetic-probes.yml)
(also runnable on demand with `workflow_dispatch`, and locally — see the
script's header comment for the required environment variables).

**Flake tolerance:** target is under 2% failed runs over a rolling 7-day
window, excluding runs that failed on an `infra` step during a known RPC
provider incident. Each run appends one JSON line to
`synthetic-probe-results.jsonl` (uploaded as a workflow artifact) recording
per-step pass/fail and duration — that log is the source of truth for
computing the flake rate and for the results dashboard trend lines (see
[dashboards.md](./dashboards.md)).

## 3. Failure categorization and triage

Every recorded step carries a `category`:

- **`infra`** — auth network calls, or the on-chain submit/confirm of the
  deposit transaction. A failure here usually means the RPC provider, the
  testnet itself, or network connectivity, not application code.
- **`app`** — the trade create/deposit-build/confirm/release calls against
  the staging backend itself. A failure here points at application code or
  the staging deployment.

On failure, the probe:

1. Prints a `🚨 [SYNTHETIC PROBE ALERT]` block naming the failed step,
   category, and error.
2. Exits non-zero, which fails the GitHub Actions job and posts a
   `$GITHUB_STEP_SUMMARY` note.
3. Dispatches a `synthetic_probe_failure` alert via the shared alert
   webhook (see [alert-routing-policy.md](./alert-routing-policy.md)) if
   `ALERT_WEBHOOK_URL` is configured, so on-call is paged the same way as
   any other production-impacting alert — dedup follows the 15-minute
   window defined for this alert type in `backend/src/config/alertRegistry.ts`,
   so a broken build doesn't repage every hour while it's being fixed.

Triage a failure by first checking the `category`: `infra` failures are
usually transient (retry, or check the RPC provider's status page before
escalating); `app` failures should be treated like any other staging
regression — follow [incident-response.md](./runbooks/incident-response.md)
if the same class of break also affects production.

## 4. Accounts

The probe uses two dedicated, low-value testnet accounts
(`SYNTHETIC_PROBE_BUYER_SECRET`, `SYNTHETIC_PROBE_SELLER_SECRET`), configured
as GitHub Actions secrets and isolated from any real user data — trades they
create are clearly marked (`"synthetic probe trade - safe to ignore"`) and
touch no production tables. Rotate these secrets on the same quarterly
cadence as other operational secrets — see
[secrets-policy.md](./secrets-policy.md).

## 5. Resetting staging to the baseline

The probe assumes staging sits on a known-good baseline: the schema produced by
all committed Prisma migrations plus the fixture set written by
`backend/prisma/seed.staging.ts`. Manual debugging sessions can leave extra
trades, mutated statuses, or half-consumed idempotency locks behind, which makes
probe runs non-reproducible.

After any manual staging debugging session, restore the baseline with:

```bash
./scripts/staging-reset.sh --yes
```

[`scripts/staging-reset.sh`](../scripts/staging-reset.sh) performs, in order:

1. `prisma migrate reset --force --skip-seed` — drops the schema and replays
   every committed migration.
2. `npx tsx prisma/seed.staging.ts` — reloads the staging fixture set.
3. `redis-cli FLUSHALL` on the staging Redis — clears idempotency locks and
   cached responses that would otherwise replay or reject probe requests.
4. [`scripts/staging-validate.sh`](../scripts/staging-validate.sh) — proves the
   seeded baseline (table counts, status coverage, referential integrity) is
   actually in place.

Safety notes:

- The script **refuses to run** unless the target database name looks like
  staging (or `--force` is passed), so a production URL cannot be wiped by
  accident.
- `--dry-run` prints the plan and runs the guard without changing anything;
  `--skip-redis` / `--skip-validate` narrow the steps when needed.
- It requires `--yes` (or an interactive confirmation) before destroying data.

Runners that need a full infrastructure restart (not just data) can use
`./scripts/staging-up.sh --reset`, which recreates the staging volumes and then
seeds; `staging-reset.sh` is the lighter, data-only path for after a debugging
session.

## 6. Pre-release hook

Before promoting a release candidate to production, check the most recent
scheduled probe run (or trigger one on demand via `workflow_dispatch`) as
part of the release checklist alongside
[`scripts/staging-validate.sh`](../scripts/staging-validate.sh) and the
[admin route smoke test](./staging-smoke-testing.md) — a red probe blocks
promotion the same way a failed smoke test does.

## 7. Game-day validation

To validate the probe itself catches real breakage, intentionally break a
staging deployment (e.g. temporarily misconfigure `STELLAR_RPC_URL`, or
have `POST /trades/:id/release` return an error) and confirm:

- The probe fails at the expected step with the expected `category`.
- The `synthetic_probe_failure` alert fires (if `ALERT_WEBHOOK_URL` is
  configured) and is not swallowed by dedup from a prior unrelated failure.
- The GitHub Actions job fails and the step summary explains what broke.

Revert the intentional break immediately after and confirm the next
scheduled run goes green.

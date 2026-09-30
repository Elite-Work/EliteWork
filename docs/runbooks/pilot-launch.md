# Pilot Launch Runbook

Operational runbook for the **public pilot program with regional agricultural
cooperatives** — the last open item on the roadmap (Phase 4,
[README.md](../README.md#phase-4-mainnet--scale)). This is a *limited* launch:
a small, known set of cooperatives on `mainnet` behind a feature flag, with a
clear off-ramp. It is intentionally not general availability (GA).

Companion docs:

- [deployment.md](./deployment.md) — how backend/frontend/contract ship.
- [rollback.md](./rollback.md) — general rollback principles (prefer code
  rollback over data rollback).
- [admin.md](../api/admin.md#feature-flags) — the feature-flag admin API used
  to gate and pause the pilot.

## Scope of the pilot

- **Audience**: a fixed, allow-listed set of regional agricultural
  cooperatives (seeded into the pilot allow-list before launch).
- **Surface area**: trade creation, funding, in-transit, delivery confirmation,
  and dispute flow on `mainnet` for those cooperatives only.
- **Gating**: the entire pilot is behind the `pilot_program` feature flag
  (default `off`). Cooperatives are enabled per-`walletAllowList` entry, not
  globally, so a single bad cohort can be paused without touching the others.
- **Out of scope for pilot**: open self-serve signup, public marketing, and any
  contract parameter changes beyond what staging already exercised.

## Pre-launch checklist

Complete every item before flipping `pilot_program` to `on` for any cohort.

1. **CI is green** on the launch commit (`.github/workflows/ci.yml`), including
   the contract safety check (`scripts/check-contract-deployment-safety.sh`).
2. **Contract is deployed to `mainnet`** and its ID is wired into the backend
   env (`STELLAR_NETWORK=mainnet`, treasury/escrow contract ID set per
   [deployment.md](./deployment.md#contract-deployment)). Verify contract
   state for a known trade id returns `200`.
3. **Feature flag exists and defaults to `off`** (`pilot_program` in the flag
   config, see [admin.md](../api/admin.md#feature-flags)). Confirm via the admin
   API that it is currently `false` in `production`.
4. **Cooperative allow-list is seeded** in `production` (wallet addresses +
   cohort labels). Confirm the seed loaded by querying one allow-listed wallet
   through the admin/allow-list endpoint.
5. **Migrations (if any) are applied and backed up** per
   [database-migration.md](./database-migration.md). Take a fresh production
   backup before launch.
6. **Support mailbox + `buildSupportMailto`** routing is verified end-to-end
   (the trade-list and admin error banners point cooperatives at a real human).
   See `mobile/src/constants/support.ts` and
   `frontend/src/constants/support.ts`.
7. **Observability is in place** for the pilot gates below:
   - Settlement success rate and median settlement latency per cohort.
   - Dispute rate and median time-to-resolution.
   - Escrow fund/release failure count.
   - `pilot_program` flag-evaluation count and allow-list hit/miss rate.
8. **Rollback is rehearsed**, not just read: confirm you can flip
   `pilot_program` to `off` (instant, no redeploy) and that in-flight trades
   remain inspectable/settle-able via the admin tools.
9. **Pilot comms** are sent to cooperatives: what's live, the pause/off-ramp,
   and the support contact. Keep it to the allow-listed cohorts only.
10. **Success metrics baseline** is recorded (the "before" numbers the gates in
    the next section are measured against).

## Launch (go live)

1. Enable the `pilot_program` flag for the first cohort only via the admin
   feature-flag API (`enabled: true`, scoped to that cohort's allow-list).
   This is immediate — no redeploy.
2. Sanity-check one cooperative wallet end-to-end: create → fund → mark
   in-transit → confirm delivery → release. Watch error logs for one full
   request-rate cycle.
3. Only after the first cohort is healthy for the agreed warm-up window, enable
   additional cohorts one at a time, repeating step 2 each time.

## Rollback / pause plan

The pilot must be pausable **without** a redeploy and **without** touching
data. Prefer the flag off-ramp; reserve a full code rollback for contract or
backend regressions.

### Preferred: pause via feature flag (instant)

1. Set `pilot_program` → `false` for the affected cohort (or globally) via the
   admin feature-flag API. Takes effect immediately, no redeploy.
2. In-flight trades are **not** cancelled — they remain visible and
   settle-able through the admin tools and the cooperative's own wallet. The
   flag only gates *new* trade creation / entry into the pilot surface.
3. Notify the affected cooperative(s) that new trade creation is paused;
   existing trades continue to settle normally.
4. Investigate, fix forward behind the flag (or via a normal
   [deployment](./deployment.md)), then re-enable the cohort.

### If a flag-off isn't enough (backend/contract regression)

Follow [rollback.md](./rollback.md): redeploy the previous known-good build,
verify `GET /health/ready` and `GET /health/startup`, then shift traffic. Do
**not** roll back the database unless the regression wrote bad data — see the
"roll back code before data" principle. If the contract itself is the problem,
coordinate with the treasury admin keys (`ADMIN_STELLAR_PUBKEYS`) and treat as
a contract incident, not a silent rollback.

### If the pilot must end entirely

1. Set `pilot_program` → `false` globally.
2. Communicate the wind-down to cooperatives with a settlement deadline for
   in-flight trades.
3. Leave historical trade/settlement data intact for audit; do not purge.

## Metrics that gate pilot → GA

The pilot moves to general availability only when **all** of the following
hold for the full pilot window (recommend ≥ 4 weeks of sustained activity, or
≥ N settled trades where N is agreed with product — start with N = 200):

| Gate | Target | Why |
|---|---|---|
| Settlement success rate | ≥ 99% of funded trades settle without manual intervention | Core promise of the escrow works in the field. |
| Dispute rate | ≤ 5% of completed trades | Cooperative flows aren't generating undue conflict. |
| Median time-to-resolution (disputes) | ≤ 72h | Disputes don't strand cooperative funds. |
| Escrow fund/release failure rate | ≤ 1% | Stellar/contract path is reliable on mainnet. |
| Support contact rate | ≤ 10% of active cooperatives/week | The UX is usable without hand-holding. |
| Cohort retention | ≥ 60% of cohorts create a trade in week 4 | The program has durable uptake. |
| Zero P1/P0 incidents attributable to pilot code | must hold for the final 2 weeks | Stable enough to open up. |

**Decision rule**: if any hard gate is missed, the pilot stays as-is (flag on
for existing cohorts) and the missed gate is remediated; GA is deferred. If a
*soft* gate (retention/support) is missed but hard gates pass, GA may proceed
with the gap tracked as a post-GA item. Record the final numbers in this
runbook's sibling `slo-snapshots/` and link them from the GA sign-off.

## Post-pilot (GA sign-off)

1. Capture the gate numbers above and store them under `slo-snapshots/`.
2. Flip `pilot_program` from allow-list-gated to generally enabled (or retire
   the flag) via a normal [deployment](./deployment.md), with a fresh backup.
3. Update [README.md](../README.md#phase-4-mainnet--scale) to check the pilot
   item and note GA date.
4. Close the pilot program roadmap item and link this runbook from the
   onboarding docs for the next cohort type.

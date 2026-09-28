# Runbook: Pilot Launch, Pause, and General Availability

Covers the cooperative pilot on the Phase 4 roadmap ("Public pilot program with
regional agricultural cooperatives", [README §Roadmap](../../README.md#-roadmap)):
how to launch it, how to pause it if it goes wrong, and the measurements that
gate promoting it from pilot to general availability.

Companion docs: [ADR-005 pilot onboarding](../adr/ADR-005-pilot-onboarding.md)
(the allowlist this runbook operates), [ADR-009 pilot cohort
metrics](../adr/ADR-009-pilot-cohort-metrics.md) (the panels the gates read),
[dashboards.md](../dashboards.md) (panel/metric reference), [deployment.md](./deployment.md)
(how a release actually ships), [rollback.md](./rollback.md) (how to reverse a
release), [slo.md](../slo.md) (S1–S4 targets), and
[incident-response.md](./incident-response.md) (when this becomes an incident).

## Scope and entry points

This runbook applies while the pilot cohort is live or being staged. It has
three entry points:

| Entry point | Use this section |
|---|---|
| A cooperative is about to be onboarded | [Pre-launch checklist](#pre-launch-checklist) |
| The pilot needs to be paused, in whole or in part | [Pause ladder](#pause-ladder) |
| Deciding whether the pilot graduates to GA | [Promotion criteria](#promotion-criteria) |

**A pause is not a rollback.** Pausing is a scoped, reversible change to *who
may use* the pilot (`COOPERATIVE_ADMINS` / `COOPERATIVE_MEMBERS`, see
[ADR-005](../adr/ADR-005-pilot-onboarding.md)). A rollback reverses *code or
schema* ([rollback.md](./rollback.md)). Most pilot incidents need the former,
not the latter — reaching for a deploy rollback first makes a scoped problem
into a platform-wide one.

## Pre-launch checklist

Complete every item before the first cooperative goes live. Items marked
**[blocking]** must be true at launch, not shortly after.

**Access and configuration**

1. **[blocking]** The cooperative's admins and members are resolved to wallet
   addresses, and the `COOPERATIVE_ADMINS` / `COOPERATIVE_MEMBERS` values for
   the target environment are written to that environment's config (see
   [env-validation.md](../env-validation.md) for how those variables are
   validated at startup).
2. **[blocking]** A rollback path for the allowlist itself is prepared: the
   current allowlist value, saved somewhere retrievable, so a bad edit can be
   reverted without reconstructing it. Removing a member is an env change plus
   a restart — see [ADR-005](../adr/ADR-005-pilot-onboarding.md#3-application).
3. Any pilot-only behaviour ships behind a **feature flag defaulted to off**
   ([admin.md §feature flags](../api/admin.md#feature-flags)), so it can be
   disabled without a redeploy. This is also the pre-deploy requirement in
   [deployment.md §Pre-deploy checklist](./deployment.md#pre-deploy-checklist).

**Observability**

4. **[blocking]** The pilot-cohort dashboard
   (`infra/grafana/dashboards/pilot-cohort.json`, uid `amana-pilot-cohort`) is
   provisioned and rendering. Its four panels are trades per cooperative, GMV
   per region, dispute rate per cooperative, and bulk-import rows by outcome
   ([dashboards.md](../dashboards.md)).
5. **[blocking]** The metrics backing those panels are emitting from the real
   onboarding flow — `amana_cooperative_trades_total{cooperative,region,event}`,
   `amana_cooperative_gmv_usdc_cents{cooperative,region}`, and
   `amana_bulk_import_total{outcome}` ([ADR-009](../adr/ADR-009-pilot-cohort-metrics.md)).
   A panel that has never received a data point is not a gate.
6. S1–S4 alerts are routed with a runbook link per
   [alert-routing-policy.md](../alert-routing-policy.md), and the error-budget
   freeze threshold (≥90% of budget consumed, [slo-burn.md](./slo-burn.md)) is
   understood by whoever is on call for the launch.

**Correctness and safety**

7. **[blocking]** Nightly E2E trade-lifecycle tests are green on the release
   being launched, and its milestone gate is passed
   ([nightly-e2e-lifecycle.md](./nightly-e2e-lifecycle.md#milestone-gate)).
8. **[blocking]** Escrow funds handling is exercised end-to-end against the
   target network: create → deposit → release, and create → deposit → dispute →
   settlement. This is the same journey the hourly synthetic probe covers in
   staging ([synthetic-probes-policy.md](../synthetic-probes-policy.md)).
9. Mediator coverage for the pilot cohort is confirmed, with the quorum
   requirements in [mediator-quorum.md](../mediator-quorum.md) satisfied —
   otherwise disputes stall and the dispute-rate gate is unreadable.

**Operations**

10. The support/communication channel for pilot cooperatives is open, and the
    cooperative knows how to report a problem and who receives it.
11. A named pilot owner and a named on-call engineer are assigned for the
    launch window, with a daily check-in cadence agreed.
12. The pause authority is decided in advance: who can order each rung of the
    [pause ladder](#pause-ladder) without further approval. In an incident,
    pausing does not wait for a postmortem.

## Launch procedure

1. **T-1 day** — Apply the allowlist change to the target environment and
   restart the service. Confirm the env validation passes on boot
   ([env-validation.md](../env-validation.md)) and that the pilot-only
   endpoints reject a non-allowlisted wallet with `403` and accept an
   allowlisted one.
2. **T-0** — Enable the pilot feature flag for the first cooperative
   ([admin.md §feature flags](../api/admin.md#feature-flags)) and watch the
   pilot-cohort dashboard for the first bulk import. Onboard one cooperative
   first; do not launch the whole cohort at once.
3. **T-0 → T+7d** — Hold the launch window at one cooperative until it has a
   full week of data. Confirm `amana_bulk_import_total{outcome}` shows
   successful imports and the cooperative panels are non-empty.
4. **After the canary week** — Onboard the remaining cohort cooperatives one at
   a time, re-checking the health endpoints
   ([deployment.md §Post-deploy verification](./deployment.md#post-deploy-verification))
   between each.
5. **Throughout** — Log each cooperative's launch date. The
   [promotion criteria](#promotion-criteria) are measured per cohort over a
   28-day window, so the window start matters.

If anything in steps 1–4 fails, go to the [pause ladder](#pause-ladder) rather
than attempting a forward fix under pressure.

## Pause ladder

Pausing is graduated. Pick the **lowest rung that contains the problem** — the
goal is to protect funds and users without discarding pilot data you still need
for the promotion decision. Every rung is reversible.

| Rung | Name | Trigger | Action | Reversal |
|---|---|---|---|---|
| **L0** | Observe | An anomaly with no user or fund impact | Do nothing structural. Note it and keep watching the cohort panels. | n/a |
| **L1** | Feature off | A specific pilot-only feature misbehaves | Set its flag `enabled: false` via the admin API ([admin.md §feature flags](../api/admin.md#feature-flags)). Takes effect immediately, no redeploy. | Re-enable the flag |
| **L2** | Onboarding freeze | Import failures, or any doubt about new-cohort correctness | Stop onboarding new cooperatives. Leave existing ones running. | Resume onboarding |
| **L3** | Single-cooperative pause | One cooperative is the source: bad data, a compromised wallet, a fund-risk pattern | Remove that cooperative's addresses from `COOPERATIVE_ADMINS` / `COOPERATIVE_MEMBERS` and restart. Its members receive `403` on pilot endpoints. | Re-add the addresses and restart |
| **L4** | Pilot halt | Fund risk, or correctness doubt spanning the cohort | Clear the cohort from the allowlist entirely and freeze bulk import. In-flight trades continue to settlement — a pause must not strand escrowed funds. | Restore the allowlist and restart |
| **L5** | Technical rollback | The cause is a bad *release*, not the cohort | Follow [rollback.md](./rollback.md). Code before data. | Per [rollback.md](./rollback.md) |

**Rung notes**

- **L1 is almost always faster than anything below it.** As in
  [rollback.md](./rollback.md#backend-rollback), disabling the offending flag
  beats a full rollback — it needs no build, no redeploy, and no data decision.
- **L3 and L4 are env changes plus a restart**, so they cost a service restart.
  Batch them: decide all allowlist edits, make them once, restart once.
- **Never pause by deleting escrow state or history.** The pilot-cohort
  metrics and the promotion decision depend on that data surviving the pause.
- **L4 must not strand funds.** Removing access is not the same as cancelling
  obligations. Trades already deposited must be allowed to reach
  `released`/`refunded`/`disputed`; if the pause would strand them, that is an
  incident, not a pause.

**Escalate out of this runbook when:**

- Funds have moved incorrectly, or a loss-share settled wrongly → this is not a
  pause, it is a fund-correctness incident:
  [incident-response.md](./incident-response.md), then the corrective
  transaction path in [emergency-clawback.md](./emergency-clawback.md).
- The bad state is on-chain and deliberate correction is required — Soroban
  state is not reversible by redeploy
  ([rollback.md §Contract rollback](./rollback.md#contract-rollback)).
- The release itself is implicated → [rollback.md](./rollback.md), and if it
  involved a migration, [database-migration.md](./database-migration.md) first.

**Pause exit criteria.** A pause lifts when (a) the triggering signal has
returned to its pre-pause level for at least one full dashboard window, (b) the
root cause is identified, and (c) if the cause was a defect, a regression guard
is merged. Re-launch by resuming at the rung above the one you stopped at —
never re-onboard the whole cohort at once after a pause.

## Promotion criteria

Promotion to GA is a decision on evidence, not on elapsed time. All gates are
measured over a **28-day window** to match the SLO window in
[slo.md](../slo.md), and read from the pilot-cohort dashboard alongside
golden-signals.

### Reliability gates

These reuse the platform's existing targets rather than inventing pilot ones:

| # | Gate | Metric / source | Threshold |
|---|---|---|---|
| G1 | API availability during the pilot | S1, `http_server_duration_milliseconds_count` by status ([slo.md](../slo.md)) | Within the 99.9% target — error budget **not** exhausted |
| G2 | API latency | S2 p95 handler duration | Within the ≤1000 ms target |
| G3 | Escrow release success | S3, `amana_trades_total{event}` | ≥99.5% of terminal settlements `released` |
| G4 | Event processing lag | S4, `event_listener_processing_lag_seconds` | p95 ≤5 min |

An exhausted S1–S4 budget **blocks** promotion: the platform does not get a
larger blast radius while a core SLO is burning
([slo-burn.md](./slo-burn.md)).

### Pilot-specific gates

| # | Gate | Metric / source | Threshold |
|---|---|---|---|
| G5 | Operational adoption | `amana_cooperative_trades_total{cooperative,region,event}` | Every onboarded cooperative has non-zero settled trades; no cooperative is onboarded-but-idle |
| G6 | Bulk-import reliability | `amana_bulk_import_total{outcome}` | Successful imports dominate failures; failure rate is not trending up across the window |
| G7 | Dispute rate | Dispute-rate-per-cooperative panel, `amana_cooperative_trades_total{event="disputed"}` | Stable or falling per cooperative, and explained by the loss-share model in [ADR-002](../adr/ADR-002-escrow-loss-sharing-model.md) rather than by process failure |
| G8 | Payout correctness | S3 breakdown plus manual reconciliation of settled trades | No unresolved reconciliation gap on any cooperative |

> G5–G8 numeric thresholds are **proposals pending the first pilot review**,
> the same convention [slo.md](../slo.md) uses for its own initial targets. Lock
> them to the first four weeks of real measurements before treating any of them
> as a pass/fail gate.

### Blocking prerequisites

These are implementation gaps the ADRs already flag. They are not metrics, and
promotion cannot proceed while any of them is open:

- **The static allowlist must be replaced.** [ADR-005](../adr/ADR-005-pilot-onboarding.md)
  states the env-var allowlist "will not scale" and must become a
  database-backed KYC/RBAC system before general availability. GA cannot be
  gated on a mechanism whose own ADR forbids it at GA.
- **G7 is only measurable once cooperative context reaches non-bulk flows.**
  Per [ADR-009](../adr/ADR-009-pilot-cohort-metrics.md), single-trade and
  on-chain lifecycle events stay invisible to the per-cooperative panels until
  the `Trade.cooperativeId` migration ([ADR-006](../adr/ADR-006-cooperative-account-model.md))
  lands. Until then the dispute-rate gate reads only bulk-imported trades and
  must be reported with that caveat.
- **`region` defaults to the cooperative slug** when the importer omits it
  ([ADR-009](../adr/ADR-009-pilot-cohort-metrics.md)), so GMV-per-region is
  lossy for multi-region cooperatives. Multi-region cohorts need explicit
  modelling before G5/G7 are trusted per region.

### Decision and record

1. The pilot owner assembles the 28-day window for G1–G8 and confirms no
   blocking prerequisite is open.
2. Any S1–S4 budget exhaustion or unresolved G8 gap goes to the SLO review
   ([slo-review-log.md](../slo-review-log.md)) before a promotion decision.
3. The promotion decision is recorded as a release note
   ([release-note-template.md](../releases/release-note-template.md)) and the
   roadmap item in [README §Phase 4](../../README.md#-roadmap) is ticked only
   when the pilot is actually GA — not when this runbook is written.

If a gate fails, the outcome is a continued pilot or a [pause](#pause-ladder),
not a partial promotion. Do not promote the cohort that looks healthiest.

## Roles and escalation

| Role | Owns |
|---|---|
| Pilot owner | Pre-launch checklist, cooperative comms, promotion evidence, the GA decision package |
| On-call engineer | Launch-window monitoring; L1/L2 pauses; initiating L3–L5 |
| Fund-correctness escalation | Any L5 involving fund state — [incident-response.md](./incident-response.md) severity levels; [emergency-clawback.md](./emergency-clawback.md) for corrective transactions |
| SLO review | Ratifying G5–G8 thresholds; adjudicating budget exhaustion affecting promotion |

Pausing is not a judgement call to defer: **L1–L4 may be actioned by the
on-call engineer without waiting for the pilot owner.** L5 follows
[rollback.md](./rollback.md), and any incident uses
[incident-response.md](./incident-response.md) — this runbook sits underneath
that process, it does not replace it.

## Related

- [ADR-005: Pilot Onboarding Flow and Lightweight KYC](../adr/ADR-005-pilot-onboarding.md)
- [ADR-009: Pilot Cohort Metrics](../adr/ADR-009-pilot-cohort-metrics.md)
- [ADR-006: Cooperative Account Model](../adr/ADR-006-cooperative-account-model.md)
- [dashboards.md](../dashboards.md) — pilot-cohort and golden-signals panels
- [deployment.md](./deployment.md) — shipping a release
- [rollback.md](./rollback.md) — reversing a release (including contract rollback)
- [database-migration.md](./database-migration.md) — migrations and their rollback
- [slo.md](../slo.md) and [slo-burn.md](./slo-burn.md) — S1–S4 targets and the freeze policy
- [incident-response.md](./incident-response.md) — severity, roles, stand-down
- [nightly-e2e-lifecycle.md](./nightly-e2e-lifecycle.md) — lifecycle gate
- [synthetic-probes-policy.md](../synthetic-probes-policy.md) — hourly escrow-journey probe
- [mediator-quorum.md](../mediator-quorum.md) — dispute quorum
- [emergency-clawback.md](./emergency-clawback.md) — corrective fund action

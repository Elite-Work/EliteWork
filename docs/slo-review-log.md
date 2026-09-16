# SLO Review Log

Running minutes of the monthly SLO reviews (docs/slo.md § Review cadence and
ownership). Each entry links the PR that changed targets/burn policy and notes
freezes, reliability sprints, and budget consumption.

<!--
Date: <date>
Attendees: <list>
Targets reviewed: S1/S2/S3/S4
Budget consumption (from slo-snapshots/slo-snapshot.jsonl the preceding week):
  - S1: <x>%
  - S2: <x>%
  - S3: <x>%
  - S4: <x>%
Decisions:
  - <decision, with PR links>
Open actions:
  - [ ] <action>
-->

## 2026-08-31 — Initial SLO ratification

- Ratified the four SLOs and initial targets in `docs/slo.md`:
  - S1 availability 99.9% / 28d
  - S2 latency p95 ≤ 1000ms / 28d
  - S3 payout success ≥ 99.5% / 28d
  - S4 event-processing lag p95 ≤ 5min / 28d
- Approved the burn policy: fast burn (1h, 1200×) → page,
  slow burn (6h, 9.3×) → ticket; ≥ 90% budget → freeze + reliability sprint.
- Assigned per-SLO ownership (see `docs/slo.md` table).
- Agreed targets are provisional until first measurement; numeric confirm /
  adjustment deferred to the first meeting with real 28-day data.
- Open actions:
  - [ ] Confirm SLO targets against first 28 days of real data.
  - [ ] Verify burn alerts fire in staged fault tests.
  - [ ] Confirm weekly snapshot workflow producing data.

## 2026-08-31 — First post-ratification review + burn verification

- Confirmed the burn-alert path is sound by closing a config-as-code gap: the
  fast/slow **1h/6h short-window recording rules for S1 and S2 were missing**
  even though `slo-alerting-rules.yml` referenced them — those two SLOs' burn
  alerts could never have fired. Added them to
  `infra/prometheus/slo-recording-rules.yml` and validated with a new
  dependency guard (see below).
- Landed [`scripts/slo-fault-test.sh`](https://github.com/anomalyco/EliteWork/blob/main/scripts/slo-fault-test.sh):
  rule-only lint + full fault round-trip harness that asserts all 8 burn
  alerts (4 fast/page + 4 slow/ticket) have their input series defined and
  fire under staged faults. Wired into CI on SLO rule changes
  (`.github/workflows/slo-fault-test.yml`).
- Added SLO trend panels to the golden-signals dashboard
  (`infra/grafana/dashboards/golden-signals.json`): 28d error-budget consumed,
  28d good-ratio, and current 6h burn rate.
- Extended `slo-snapshot.ts` to also record `burn_rate_1h`/`burn_rate_6h` per
  SLO, so the weekly snapshot doubles as a burn-trend source for the review.
- Reviewed budget consumption from `slo-snapshots/slo-snapshot.jsonl`:
  no real 28-day data yet (tracking just started); targets remain provisional.
- Decisions:
  - Keep all four targets provisional until 28 days of real data accrue.
  - Burn policy (fast 1h/1200×→page, slow 6h/9.3×→ticket, ≥90% freeze) stands.
- Open actions:
  - [ ] Re-ratify target numbers at the first meeting with real 28-day data
        (expected ~2026-09-28, one month after tracking start).
  - [ ] Run the live Prometheus fault round-trip in staging once deployed
        (`PROMETHEUS_URL=... ./scripts/slo-fault-test.sh`).

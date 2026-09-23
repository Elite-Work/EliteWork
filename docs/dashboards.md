# Golden Signals Dashboard (stored as code)

A canonical Grafana dashboard covering latency, traffic, errors, and
saturation per service, so incident triage starts from one shared view
instead of everyone hand-building their own queries. Complements
[METRICS.md](./METRICS.md) (frontend analytics event schema) — this covers
backend/infra signals instead.

## Files

- [`infra/grafana/dashboards/golden-signals.json`](../infra/grafana/dashboards/golden-signals.json)
  — the dashboard definition itself.
- [`infra/grafana/dashboards/pilot-cohort.json`](../infra/grafana/dashboards/pilot-cohort.json)
  — pilot-cohort metrics for the cooperative program (issue #46): trades per
  cooperative, GMV per region, dispute rate per cooperative, and bulk-import
  row outcomes. Same provisioning as below — any JSON in the dashboards
  directory is picked up automatically. Attribution flows from the
  bulk-import path when the caller belongs to the labelled cooperative
  (see [ADR-009](./adr/ADR-009-pilot-cohort-metrics.md)); panels read empty
  until the first attributed batch lands.
- [`infra/grafana/provisioning/dashboards/dashboards.yaml`](../infra/grafana/provisioning/dashboards/dashboards.yaml)
  and [`infra/grafana/provisioning/datasources/datasources.yaml`](../infra/grafana/provisioning/datasources/datasources.yaml)
  — Grafana's file-provisioning config, so the dashboard and its Prometheus
  datasource are created automatically on a fresh Grafana instance with no
  manual import step.
- [`scripts/grafana-deploy-annotation.sh`](../scripts/grafana-deploy-annotation.sh)
  — posts a deploy marker annotation to Grafana; wired into
  [`.github/workflows/staging.yml`](../.github/workflows/staging.yml) as a
  non-blocking post-deploy step (`continue-on-error: true` — a missing
  `GRAFANA_URL`/`GRAFANA_API_KEY` secret just skips it, never fails the
  deploy).

## Panels

| Panel | Signal | Source metric |
|---|---|---|
| API request rate | Traffic | `http_server_duration_milliseconds_count` (OTel HTTP auto-instrumentation) |
| API latency p95/p99 | Latency | `http_server_duration_milliseconds_bucket` |
| Stellar transaction error rate | Errors | `stellar_transaction_submissions_total` (`backend/src/lib/metrics.ts`) |
| Soroban RPC health | Errors/Latency | `soroban_rpc_health_checks_total`, `soroban_rpc_health_check_duration_ms` |
| Database saturation | Saturation | `pg_stat_activity_count` / `pg_settings_max_connections` |
| Job queue depth | Saturation | `redis_key_length_total{key=~"bull:.*:wait"}` |
| Stellar RPC call duration p95 by method | Latency | `stellar_rpc_duration_ms` |
| **SLO error budget consumed (28d)** | SLO | `slo:<id>:error_budget_consumed:ratio28d` |
| **SLO good ratio (28d)** | SLO | `slo:<id>:good_ratio:*28d` |
| **SLO burn rate (current 6h)** | SLO | `slo:<id>:error_budget_consumed:ratio6h` |

The last three panels derive from the SLO recording rules in
[`infra/prometheus/slo-recording-rules.yml`](../infra/prometheus/slo-recording-rules.yml),
so they need the Prometheus server to have the SLO rule groups loaded (the
same requirement as the burn alerts — see `docs/slo.md`). Budget-consumed
panels carry thresholds at 60%/90%/100% to match the freeze/incident policy.

## Prerequisites

The app's own OTel Prometheus exporter (`backend/src/config/tracing.ts`,
`PROMETHEUS_PORT`, default `9464`, path `/metrics`) covers the HTTP and
Stellar/Soroban panels directly. Two panels need additional exporters that
aren't part of this repo's runtime:

- **Database saturation** needs [`postgres_exporter`](https://github.com/prometheus-community/postgres_exporter)
  scraping the same Postgres instance.
- **Job queue depth** needs [`redis_exporter`](https://github.com/oliver006/redis_exporter)
  with a `check-keys` pattern matching BullMQ's `bull:<queue>:wait` lists.

Neither exporter is included here — add them to your Prometheus scrape
config for the environment before relying on those two panels.

**Verify metric names before relying on this dashboard.** OTel's Prometheus
exporter naming (unit suffixes, `.` → `_` conversion) has changed across SDK
versions. After first deploying the exporter in an environment, hit
`http://<backend-host>:9464/metrics` and confirm the HTTP-latency metric
name matches what the dashboard queries — adjust the two `http_server_*`
panel queries in the JSON if your SDK version names it differently (the
Stellar/Soroban panels use this repo's own explicitly-named custom metrics,
so those are stable regardless of SDK version).

## Importing / provisioning

**Automated (recommended):** mount `infra/grafana/provisioning/` into
Grafana's provisioning directory (`/etc/grafana/provisioning/` in the
official Grafana image) and `infra/grafana/dashboards/` into
`/etc/grafana/provisioning/dashboards/files/` (matching the `path` in
`dashboards.yaml`). A fresh Grafana container picks up both the datasource
and dashboard on startup — no UI steps.

**Manual (one-off check):** Grafana UI → Dashboards → New → Import → paste
the contents of `golden-signals.json`. Confirms the JSON is well-formed
before wiring up automated provisioning.

## Walkthrough

1. Deploy the app with `PROMETHEUS_PORT` set and something scraping it
   (Prometheus server pointed at `/metrics` on that port).
2. Provision Grafana as above; open the "Amana" folder, "Amana — Golden
   Signals" dashboard.
3. Confirm the top row (request rate, latency) populates first — those come
   straight from HTTP auto-instrumentation and need no extra setup.
4. Trigger a few Stellar transactions in the environment (or run the
   [synthetic probe](./synthetic-probes-policy.md)) and confirm the Stellar
   error-rate and RPC-duration panels populate.
5. If you've added `postgres_exporter`/`redis_exporter`, confirm the
   saturation row populates too.
6. Deploy again through `staging.yml` and confirm a "Deploy" annotation
   marker appears on the dashboard at the deploy time.

(No screenshot is checked into the repo — capture one from your own Grafana
instance once provisioned, since panel appearance depends on your Grafana
theme/version, and attach it to this doc or the team wiki as a reference.)

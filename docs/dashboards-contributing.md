# Contributing a Grafana dashboard change

How to add a panel to a dashboard in `infra/grafana/dashboards/`, validate it,
and test it locally before opening a PR. For what the existing dashboards show,
see [dashboards.md](./dashboards.md); for the metric definitions behind the
panels, see [METRICS.md](./METRICS.md).

Dashboards are stored as code and file-provisioned, so there is no import step
in production: Grafana watches the mounted dashboards directory and picks up a
changed JSON file within `updateIntervalSeconds` (30s in
[`dashboards.yaml`](../infra/grafana/provisioning/dashboards/dashboards.yaml)).
That means a merged change to the JSON is a dashboard change — review it like
code, and keep it working on the first startup.

## Repository layout

| Path | Purpose |
|---|---|
| `infra/grafana/dashboards/*.json` | Dashboard definitions. Every `*.json` in this directory is provisioned. |
| `infra/grafana/provisioning/dashboards/dashboards.yaml` | File provider config: folder name, refresh interval, and the mount path Grafana reads. |
| `infra/grafana/provisioning/datasources/datasources.yaml` | Prometheus datasource used by `${datasource}` in the panels. |
| `docs/dashboards.md` | Panel inventory and prerequisites for the shipped dashboards. |
| `scripts/grafana-deploy-annotation.sh` | Posts the deploy annotation marker; unrelated to panel changes, but runs post-deploy. |

## Rules that keep provisioning stable

These are the things that most often break a dashboard PR:

1. **Never change an existing dashboard's `uid`.** Provisioning identifies
   dashboards by UID, not filename. Changing it creates a duplicate dashboard
   and orphans the old one (with its annotations and links) instead of updating
   it. UIDs are `amana-golden-signals` and `amana-pilot-cohort` today.
2. **Reference the datasource indirectly.** Panels use `"datasource":
   "${datasource}"` and the dashboard defines a `datasource` template variable.
   Hardcoding `"Prometheus"` or a datasource UID breaks every environment whose
   datasource is named differently.
3. **Give every panel a unique `id`.** Copying a panel without changing its
   `id` makes Grafana drop or merge one of them. IDs only need to be unique
   within the dashboard; leaving gaps is fine.
4. **Store one dashboard per file, and do not rename an existing file** unless
   the dashboard itself is being split or retired. The provider keys off `uid`,
   but reviewers and links in `docs/` key off the filename.
5. **Do not commit an export wrapper.** Grafana UI exports can contain
   `__inputs`, `__requires`, and `"id": null`; the provisioned file must be the
   plain dashboard object (`title`, `uid`, `panels`, ...) as in the existing
   files.
6. **Keep panels in populated rows.** Update `gridPos.y` so the new panel does
   not overlap an existing one, and keep the panel width within the 24-column
   grid (`w` + `x` ≤ 24).

## Adding a panel

You can do this in the Grafana UI or by editing the JSON directly. The UI path
is easier for layout and query iteration; the JSON path gives a cleaner diff.

### Option A — build it in a local Grafana, export the JSON

1. Start Grafana with provisioning as described in
   [Testing locally](#testing-locally).
2. Open the dashboard, click **Edit**, then **Add → Visualization**, and build
   the panel against the local Prometheus.
3. Use **Query inspector → Panel JSON** to confirm the query and options.
4. Apply the change, then **Dashboard settings → JSON Model**, copy the whole
   object, and replace the contents of the dashboard's file in
   `infra/grafana/dashboards/`.
5. Revert the auto-incremented `version` if you like (it only matters for
   change detection) and confirm the `uid` is unchanged.
6. Format the file and check it parses:

   ```bash
   jq . infra/grafana/dashboards/<name>.json > /tmp/d.json \
     && mv /tmp/d.json infra/grafana/dashboards/<name>.json
   ```

   `python3 -m json.tool` works too if `jq` is unavailable.

### Option B — edit the JSON directly

Add an object to the dashboard's `panels` array:

```json
{
  "id": 12,
  "title": "Reconciliation drift detections",
  "description": "Which metric this reads and why the panel exists.",
  "type": "timeseries",
  "datasource": "${datasource}",
  "gridPos": { "h": 8, "w": 12, "x": 0, "y": 96 },
  "fieldConfig": {
    "defaults": { "unit": "reqps" },
    "overrides": []
  },
  "targets": [
    {
      "expr": "sum(rate(reconciliation_drift_total[5m])) by (severity)",
      "legendFormat": "{{severity}}"
    }
  ]
}
```

Checklist for the panel itself:

- `title` names the signal, not the query.
- `description` states the source metric and, if the panel exists because of an
  issue, the behaviour it makes visible — this is what lets the next person
  debug it.
- `targets[].expr` is valid PromQL against the metrics the app actually emits.
  Confirm the metric name at the exporter (`/metrics` on the backend's
  `PROMETHEUS_PORT`, default `9464`, or the Prometheus UI) before adding it;
  OTel Prometheus naming can change between SDK versions.
- `unit` is set (`s`, `ms`, `reqps`, `percentunit`, ...) so the axis is readable.
- For SLO panels, thresholds (60%/90%/100%) match the policy in
  [slo.md](./slo.md) and the recording rules in
  [`infra/prometheus/slo-recording-rules.yml`](../infra/prometheus/slo-recording-rules.yml).

## Testing locally

No Grafana instance is part of `docker-compose.yml`, so run one alongside the
stack with the same provisioning layout production uses.

1. **Start Prometheus scraping the backend** (skip if you already have one and
   only need to check rendering):

   ```yaml
   # /tmp/prometheus.yml
   global:
     scrape_interval: 15s
   scrape_configs:
     - job_name: elitework-backend
       static_configs:
         - targets: ["host.docker.internal:9464"]
   ```

   On Linux, `host.docker.internal` needs
   `--add-host=host.docker.internal:host-gateway` on the Prometheus container,
   or use the backend container's address on a shared Docker network instead.

   ```bash
   docker network create grafana-dev

   docker run --rm -d --name prometheus-dev \
     --network grafana-dev \
     -p 9090:9090 \
     --add-host=host.docker.internal:host-gateway \
     -v /tmp/prometheus.yml:/etc/prometheus/prometheus.yml:ro \
     prom/prometheus:v2.54.1
   ```

2. **Start Grafana with this repo's provisioning and dashboards mounted.** The
   dashboards mount must be nested under the provisioning mount and match the
   `path` in `dashboards.yaml`:

   ```bash
   docker run --rm -d --name grafana-dev \
     --network grafana-dev \
     -p 3000:3000 \
     -e GF_AUTH_ANONYMOUS_ENABLED=true \
     -e GF_AUTH_ANONYMOUS_ORG_ROLE=Admin \
     -e GF_USERS_ALLOW_SIGN_UP=false \
     -v "$PWD/infra/grafana/provisioning:/etc/grafana/provisioning:ro" \
     -v "$PWD/infra/grafana/dashboards:/etc/grafana/provisioning/dashboards/files:ro" \
     grafana/grafana:11.2.0
   ```

   The bundled datasource points at `http://prometheus:9090`. On this local
   network the container is named `prometheus-dev`, so add a `prometheus`
   network alias (or change the datasource URL in a temporary copy of
   `datasources.yaml`):

   ```bash
   docker network connect --alias prometheus grafana-dev prometheus-dev
   ```

   If you already had Grafana running before adding the network alias, it
   retries datasource connections automatically on the next query.

3. **Check startup logs — provisioning failures are logged, not fatal:**

   ```bash
   docker logs grafana-dev 2>&1 | grep -i -E 'provisioning|dashboard|error'
   ```

   A malformed file logs `failed to load dashboard` and that dashboard silently
   disappears, so check this even if the UI looks fine.

4. **Open `http://localhost:3000`**, go to the **Amana** folder, open the
   dashboard, and confirm:
   - the dashboard appears at all (JSON parsed and UID accepted);
   - the new panel renders with no `Datasource ${datasource} was not found`
     error;
   - the panel shows data if the backend/exporter is running, or the expected
     "No data" if the metric is only emitted in production;
   - existing panels still render — a common regression is a changed `uid` or a
     duplicate panel `id` causing the provider to replace the dashboard.

5. **Check the query independently** in Prometheus at
   `http://localhost:9090/graph` (or Grafana's Query inspector). Empty results
   there mean the panel cannot show data regardless of dashboard config.

6. **Verify a hot reload.** `updateIntervalSeconds: 30` means an edited file is
   picked up without restarting Grafana; wait for the interval and refresh the
   browser. If the change does not appear, the file is outside the mounted
   directory or Grafana rejected it — recheck the logs.

7. **Tear down:**

   ```bash
   docker rm -f grafana-dev prometheus-dev
   docker network rm grafana-dev
   ```

## Review checklist

Before opening the PR:

- [ ] `jq . infra/grafana/dashboards/<file>.json` exits 0.
- [ ] Existing dashboard `uid` values are unchanged.
- [ ] New panels have unique `id` values and non-overlapping `gridPos`.
- [ ] Queries reference the `${datasource}` variable, not a hardcoded
      datasource.
- [ ] New metric names were confirmed against `/metrics` or Prometheus.
- [ ] Grafana started locally and the dashboard appeared in the **Amana**
      folder with existing panels intact.
- [ ] `docs/dashboards.md` is updated if the panel adds a prerequisite
      exporter (like `postgres_exporter` / `redis_exporter`) or a new panel to
      the inventory.
- [ ] The change is one reviewable concern: a panel addition or a targeted
      fix, not a full-dashboard restyle mixed with query changes.

## PR description template

```markdown
## What
Adds <panel> to <dashboard file> to make <signal> visible.

## Why
<issue link / incident or SLO gap this addresses>

## Metric
- Query: `<PromQL>`
- Source: `<exporter / backend metrics file>`
- Verified against: <local Prometheus / staging / /metrics output>

## Testing
- [ ] JSON parses (`jq`)
- [ ] Grafana 11.2 started with `infra/grafana/provisioning/` — dashboard
      loaded, existing panels intact, new panel renders
- [ ] No datasource or provisioning errors in `docker logs`

## Screenshots
<optional, from a local instance>
```

Do not include the Grafana version bump or unrelated panel rearranging in the
same PR — dashboard diffs are already noisy, and a focused change is what makes
the review meaningful.

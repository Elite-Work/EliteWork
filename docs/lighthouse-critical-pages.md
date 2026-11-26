# Lighthouse CI — Critical Pages

Lighthouse CI runs performance and accessibility budgets on the critical pages:
- **`/trades/create`** — trade creation (highest-traffic authenticated page)
- **`/dashboard`** — trade stats and recent trades overview
- **`/vault`** — escrow vault overview
- **`/reputation`** — reputation overview (high traffic)

Each page has its own check that runs on every PR touching `frontend/**`. The workflow is
`.github/workflows/lighthouse.yml`; the per-page configs are
`frontend/lighthouserc.<page>.json`. The `trades-create` / `dashboard` / `vault` details
(including their baselines) are in `docs/lighthouse-trade-create.md`.

- Output: scores table in the job summary + full reports in the `lighthouse-critical-pages`
  artifact (`frontend/.lighthouseci/<page>/`, git-ignored locally)

## Budgets (median of 3 desktop runs — an `error` budget breach fails the check)

| Metric | Budget |
|---|---|
| Performance score | ≥ 0.80 |
| Accessibility score | ≥ 0.95 |
| Largest Contentful Paint | ≤ 2500 ms |
| Total Blocking Time | ≤ 400 ms (warning only) |
| Cumulative Layout Shift | ≤ 0.02 |
| First Contentful Paint | ≤ 1800 ms (warning only) |

The `reputation` budgets match the other pages so the check is consistent. They are
provisional until CI numbers are collected.

## Baselines

### reputation

Not yet measured. The first `lighthouse.yml` run on `main` after this change produces the
numbers; record them here as a `Before (main)` / `After` table in the same format as
`docs/lighthouse-trade-create.md`, then revisit the budgets.

## Running locally

```bash
cd frontend
pnpm build
npx @lhci/cli@0.15.1 autorun --config=./lighthouserc.reputation.json
```

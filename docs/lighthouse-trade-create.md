# Lighthouse CI — Trade Creation Flow

> Status: Active | Owner: Frontend | Issue: #103

`/trades/create` is the highest-traffic authenticated page, so it has a dedicated Lighthouse
CI check that runs the **performance** and **accessibility** categories on every PR that
touches `frontend/**`.

- Workflow: `.github/workflows/lighthouse-trade-create.yml`
- Config / budgets: `frontend/lighthouserc.trades-create.json`
- Output: scores table in the job summary + full HTML/JSON reports in the
  `lighthouse-trades-create` artifact

## Budgets (median of 3 desktop runs — an `error` budget breach fails the check)

| Metric | Budget |
|---|---|
| Performance score | ≥ 0.80 |
| Accessibility score | ≥ 0.95 |
| Largest Contentful Paint | ≤ 2500 ms |
| Total Blocking Time | ≤ 400 ms (warning only — varied 53–353 ms between identical local runs) |
| Cumulative Layout Shift | ≤ 0.02 |
| First Contentful Paint | ≤ 1800 ms (warning only) |

The performance budget sits below the measured baseline to absorb GitHub runner variance;
tighten it once a few weeks of CI numbers are in.

## Baseline (before / after this change)

Measured locally with `@lhci/cli@0.15.1`, desktop preset, production build, 3 runs each.

| | Performance | Accessibility | LCP | TBT | CLS |
|---|---|---|---|---|---|
| Before (`main`) | 0.87 / 0.91 / 0.96 | **0.86** | 587–813 ms | 167–303 ms | 0 |
| After | 0.87 / 1.00 / 1.00 | **0.96** | 435–551 ms | 53–310 ms | 0 |

The accessibility gain comes from fixes shipped with this check:

- `AppTopNav`: the notification and account icon buttons had no accessible name
  (`button-name`). They now have `aria-label`s, `type="button"`, and `aria-hidden` icons.
- `SideNavBar`: the nav `<li>` elements had `role="none"`, which is invalid inside a
  plain `<ul>` (`list`).

Performance differences between the two runs are mostly within run-to-run noise; the check
exists to catch regressions, not to claim a speed-up.

### Known remaining issue

`color-contrast` still fails: the `text-muted` token (`#5a7a6a`) is 3.2–3.8:1 against the
card and page backgrounds, below the 4.5:1 AA minimum. Fixing it is a design-token change
that affects every page, so it's out of scope here.

## Running locally

```bash
cd frontend
pnpm build
npx @lhci/cli@0.15.1 autorun --config=./lighthouserc.trades-create.json
```

Reports are written to `frontend/.lighthouseci/trades-create/` (git-ignored).

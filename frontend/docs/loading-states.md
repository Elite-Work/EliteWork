# Loading states & skeletons

One skeleton language across the app, driven by design tokens. No bare spinners
for content areas, no unstyled gaps, no layout shift when real data arrives.

## Primitives

| Component | Use for |
| --- | --- |
| `Skeleton` (`@/components/ui`) | The atom. `variant="text" \| "rect" \| "circle"`, explicit `width`/`height` sized from real layout metrics |
| `SkeletonText` | Multi-line paragraph placeholder |
| `SkeletonCard` | Card-shaped surface (icon + title + N lines) |
| `SkeletonList` | Repeated row list (dashboard feeds, trade lists) |
| `LoadingState` | Route-segment / panel placeholder (`variant="card" \| "row" \| "inline"`) |
| `Spinner` | **Only** for in-button / inline affordances, never a content region |

### Tokens

| Token | Value | Role |
| --- | --- | --- |
| `bg-skeleton-base` | `#E8EDE9` light / `#1A3D2C` dark | Resting fill |
| `bg-skeleton-sheen` | `rgba(26,46,31,0.06)` light / `rgba(240,245,241,0.08)` dark | Shimmer highlight |
| `animate-skeleton-pulse` | 1.6s opacity pulse | Resting motion (no reflow) |
| `animate-skeleton-shimmer` | 1.6s translateX sweep | Highlight sweep |

`motion-reduce` disables both animations automatically.

## CLS rules

1. A skeleton must occupy the **same box** its content will. Pass pixel
   `width`/`height` measured from the rendered component, not guesses.
2. Reserve space for async images/media with an aspect-ratio box.
3. Skeleton → content swap must not change container height. Match line counts
   and row counts to the typical payload.
4. Animations are opacity/transform only — never animate width/height/margin.

## Data-surface inventory

Audited against `src/app/` on 2026-10-21.

| Route / surface | Pattern | Boundary |
| --- | --- | --- |
| `/dashboard` | `Skeleton` header + 4× `SkeletonCard` stat cards, then `SkeletonList rows={4}` for the activity feed | inline (`if (loading)` branch of `page.tsx`) |
| `/trades` | `TradesTableSkeleton` (rows of `Skeleton`) | inline (`loading` flag) |
| `/trades/[id]` | Centred `animate-spin` spinner while `useTradeDetail` loads — **gap**, not a skeleton | inline (`loading` flag) |
| `/vault` | Static pulsing blocks in `loading.tsx`, then 4× `LoadingState variant="card"` | route `loading.tsx` + inline (`isLoading`) |
| `/vault/manage` | No skeleton — only a "Loading…" button label / spinning icon — **gap** | none |
| `/assets` | `AssetTableSkeleton` (built from `Skeleton`) | inline |
| `/assets/[id]` | Page-local `LoadingState()` function (not the shared `LoadingState`) | inline (`isLoading`) |
| `/reputation` | `SkeletonReputationPage`: `Skeleton` header + circular score-ring placeholder | inline |
| `/mediator/disputes` | `SkeletonList rows={PAGE_SIZE}` | inline |
| `/mediator/disputes/[id]` | No skeleton while evidence loads (tracks a `VideoLoadState` only) — **gap** | none |
| `/admin/streams`, `/admin/audit` | `SkeletonList rows={PAGE_SIZE}` | inline |
| `/admin/streams/[id]`, `/streams/[id]` | `LoadingState variant="card" rows={3}` | inline (`isLoading`) |

No async content to skeleton: `/` (landing), `/access-denied`, `/streams`
(static index with links), `/settings` (wallet connect / sign-in buttons only),
`/cooperative/bulk-import` (upload form; the only request is the submit
mutation) and the `/dev-test/*` fixtures.

> Any surface not listed here that fetches async data needs a row added and a
> skeleton wired before merge. The three **gap** rows above predate this rule.

## Suspense boundary convention

- **Route-level** (`app/<segment>/loading.tsx`): first paint of a navigation —
  use `LoadingState` matching the page's primary layout. Today only
  `app/vault/loading.tsx` exists, and it uses static pulsing blocks rather than
  `LoadingState`; every other route handles loading inline.
- **Component-level** (`<Suspense>` / `isLoading` branch): secondary data that
  streams in after the shell — use the matching primitive from the inventory.

## CLS budget / Lighthouse CI

Every Lighthouse config in `frontend/` asserts
`cumulative-layout-shift ≤ 0.02` as an **error** (Web Vitals "good" is ≤ 0.1; we
hold a tighter internal budget):

| Config | Routes | Run by |
| --- | --- | --- |
| `lighthouserc.json` | `/`, `/dashboard`, `/trades`, `/vault`, `/trades/create` | manual / local `lhci autorun` |
| `lighthouserc.trades-create.json`, `lighthouserc.dashboard.json`, `lighthouserc.vault.json` | one critical page each | `.github/workflows/lighthouse.yml` ("Lighthouse — Critical Pages", `@lhci/cli@0.15.1`) |

CI only measures `/trades/create`, `/dashboard` and `/vault`; the other routes in
the inventory are covered by the manual pass below. A regression above budget on
any of the three fails the workflow.

## Slow-network manual pass

Chrome DevTools → Network → **Slow 4G** + CPU 4× throttle, then walk every route
in the inventory:

- [ ] Skeleton appears within 100ms of navigation (no blank flash)
- [ ] No layout jump when content replaces the skeleton (record with the
      Performance panel, confirm CLS ≈ 0)
- [ ] `prefers-reduced-motion` disables shimmer/pulse
- [ ] No spinner used where a skeleton belongs

Document date + build SHA of each pass in the PR.

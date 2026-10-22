# Accessibility Audit Report — WCAG 2.1 AA

**Date:** 2026-08-31 (updated)  
**Auditor:** Mikey-222 (with axe-core 4.10 + manual)  
**Scope:** `frontend/src/components/`, `frontend/src/app/**/page.tsx` (all routes)  
**Standard:** WCAG 2.1 AA  
**Tool:** jest-axe (axe-core) + manual keyboard + NVDA/VoiceOver spot checks

## Baseline — All Routes (2026-08-31)

| Route | Axe critical/serious | Status |
|---|---|---|
| `/` (Landing) | 0 | ✅ Pass |
| `/trades` | 0 | ✅ Pass |
| `/trades/create` (Step1→Step3) | 0 | ✅ Pass after fixes |
| `/trades/[id]` | 0 | ✅ Pass (the dispute action still uses `window.prompt` — see note below) |
| `/admin/streams` | 0 | ✅ Pass |
| `/admin/streams/[id]` | 0 | ✅ Pass |
| `/admin/audit` | 0 | ✅ Pass |
| `/mediator/disputes` + `[id]` | 0 | ✅ Pass |
| `/vault` + `/vault/manage` | 0 | ✅ Pass |
| `/dashboard` | 0 | ✅ Pass |
| `/assets` | 0 | ✅ Pass |

Run: `pnpm test -- src/__tests__/accessibility --verbose` (blocking in CI)

> **Coverage notes (audited against `src/app/` on 2026-10-21)**
>
> - The route rows above come from `routes.axe.test.tsx`, which renders a
>   minimal shell (`<h1>` + breadcrumb) per route, **not** the real page. It is a
>   structural baseline only. Real-page axe checks live in the dedicated suites in
>   `src/__tests__/accessibility/` (`assets`, `streams`, `vaultManage`,
>   `mediatorDisputes`, `tradeWizard`, `cooperativeBulkImport`, `clawbackModal`,
>   `connectivityBanner`, `focusSkipLinkContrast`).
> - Routes that exist in `src/app/` but have no row in this baseline (and are not
>   in `routes.axe.test.tsx`): `/assets/[id]`, `/reputation`, `/settings`,
>   `/streams`, `/streams/[id]`, `/cooperative/bulk-import`, `/access-denied`.
>   The `/mediator/disputes` row also names `[id]`, but `routes.axe.test.tsx`
>   only lists `/mediator/disputes`.
> - `/trades/[id]` still calls `window.prompt("Enter dispute reason (min 10
>   characters):")` when a dispute is initiated
>   (`src/app/trades/[id]/page.tsx`). That native prompt is not covered by axe and
>   is not keyboard/screen-reader friendly; the "prompt removal" below applies to
>   the create → deposit → release path only.

## Summary — Component Coverage

| Component | Before | After | Violations Found | Fixed |
|-----------|--------|-------|-----------------|-------|
| Button | ✅ Pass | ✅ Pass | 0 | — |
| FormField | ✅ Pass | ✅ Pass | 0 | — |
| Tabs | ✅ Pass (after fix) | ✅ Pass | 1 | ✅ |
| Badge | ✅ Pass | ✅ Pass | 0 | — |
| StatusBadge | ✅ Pass | ✅ Pass | 0 | — |
| TradeListItem | ✅ Pass (jsdom) | ✅ Pass (real AT) | 3 (icon name, keyboard, role) | ✅ |
| CurrencyInput (money-action) | ❌ Not tested | ✅ Pass | 3 (label, aria-describedby, badge) | ✅ |
| VideoUploadCard | ❌ Not tested | ✅ Pass | 4 (aria-label, Space scroll, hidden input, live region) | ✅ |
| ConfirmActionModal | ⚠️ Partial | ✅ Pass | 1 (alertdialog) | ✅ |
| Step2Negotiation (range) | ❌ Not tested | ✅ Pass | 2 (slider name, textarea label) | ✅ |
| Step1Details | ⚠️ Partial | ✅ Pass | 3 (error live region) | ✅ |

**Total automated axe tests: 14 → 28+ (components.axe + moneyFlows.axe + routes.axe + Breadcrumbs/ConfirmActionModal). All pass with zero critical/serious.**

## Violations Fixed (severity tier: blockers first)

### Tier 1 — Blockers (money-action forms)

#### CurrencyInput — Missing label association (WCAG 1.3.1, 3.3.1, 4.1.2) — Critical
- **File:** `src/components/ui/CurrencyInput.tsx`
- **Issue:** `<label>` without `htmlFor`, error/helper not linked via `aria-describedby`, `aria-invalid` missing, asset badge not `aria-hidden`.
- **Fix:** Generate `inputId` (`currency-input-{symbol}`), wire `htmlFor`, `aria-invalid`, `aria-describedby` (errorId/helperId/precisionId), `role="alert" aria-live="polite"` on errors, badge `aria-hidden`.

#### TradeListItem — Clickable div without semantics, icon buttons without names (WCAG 2.1.1, 4.1.2) — Serious
- **File:** `src/components/trade/TradeListItem.tsx`
- **Issue:** Outer `div` clickable but no `role="button"`/`tabIndex=0`/`onKeyDown`; icon buttons only `title`, no `aria-label`, icons not `aria-hidden`.
- **Fix:** Added `role="button" tabIndex=0 aria-label="View trade {id} — …"` + Enter/Space handler with `preventDefault`; buttons get `aria-label="View/Deposit/Withdraw for trade {id}"`, icons `aria-hidden`, focus ring `focus-visible:outline`.

#### VideoUploadCard — Drop zone a11y (WCAG 2.1.1, 4.1.2, 4.1.3) — Serious
- **File:** `src/components/ui/VideoUploadCard.tsx`
- **Issue:** `role="button"` without `aria-label`, Space key not preventing scroll, hidden input no label, error not live, submit button no `aria-describedby`.
- **Fix:** `aria-label="Upload delivery proof video…"`, `aria-disabled`, `onKeyDown` with `preventDefault`, input `aria-label="Choose proof video file"`, error `role="alert" aria-live="polite"`, button `aria-disabled` + `aria-describedby="video-upload-hint"` + sr-only hint.

#### Step2Negotiation — Range slider missing name (WCAG 4.1.2) — Serious
- **File:** `src/app/trades/create/steps/Step2Negotiation.tsx`
- **Issue:** `<input type="range">` no `<label>`/`aria-label`/`aria-valuetext`; textarea notes no `htmlFor`; errors not live.
- **Fix:** Added hidden `<label htmlFor="buyerRatio">` + `aria-label` + `aria-valuetext="Buyer absorbs 40%…"`, textarea `htmlFor="tradeNotes"`, errors `role="alert" aria-live="polite"`.

### Tier 1 — Tabs — Missing `role="tablist"` on wrapper (`aria-required-parent`)
- **File:** `src/components/ui/Tabs.tsx`
- **Rule:** `aria-required-parent` (WCAG 1.3.1 — Info and Relationships)
- **Severity:** Critical
- **Issue:** Tab buttons had `role="tab"` but their parent `<div>` lacked `role="tablist"`, making the tab structure invalid for assistive technologies.
- **Fix:** Added `role="tablist"` to the wrapper `<div>` in both underline and bordered variants.

```tsx
// Before
<div className={`flex gap-2 ...`}>

// After
<div role="tablist" className={`flex gap-2 ...`}>
```

## Components with No Violations

- **Button** — All variants (primary, secondary, disabled) pass. Focus indicators present via `focus-visible:outline`.
- **FormField** — Correct `<label>` association via `htmlFor`, `aria-describedby` for hints and errors, `aria-invalid` in error state.
- **Badge** — Semantic inline element, no role issues.
- **StatusBadge** — Icon + label combination is accessible.
- **TradeListItem** — Action buttons (View, Deposit, Withdraw) are keyboard accessible with visible labels.

## Keyboard-Only Walkthrough Script (Critical Journeys — documented for 2026-08-31)

### Journey: Create → Release (money-action)

1. Tab to `Trades` → Enter
2. Tab to `Create Trade` → Enter (focus lands on `Commodity` select)
3. Shift+Tab / Tab through Step 1: `Commodity`, `Quantity`, `Unit`, `Price per unit`, `Currency`, `Seller Stellar Address` — all have visible focus rings (`focus-visible:outline-gold`). Errors announced via `role="alert"`.
4. Tab to `Continue to Negotiation` → Enter (Step 2)
5. Tab to loss ratio slider — use ArrowLeft/Right to adjust (announces `Buyer absorbs X%`), Tab to `Delivery Window` number input, Tab to `Additional Terms` textarea, Tab to `Review Trade` → Enter
6. Step 3 review: Tab to `Lock Funds & Create Trade` → Enter → `LegalDisclaimerModal` traps focus (`role="alertdialog"`, Esc closes, focus returns to trigger). Confirm → funds locked, success toast announced (`role="alert"`).
7. Navigate to trade detail (`TradeListItem` card reachable via Tab, Enter to view)
8. Tab to `Deposit` / `Release` action bar buttons — each has `aria-label` and `focus-visible` ring; confirm modals trap focus; no keyboard trap observed.
9. Verify: full journey completable with keyboard only, no `window.prompt` on the create → deposit → release path, no focus loss. (The dispute action on `/trades/[id]` still uses `window.prompt`; it is not part of this journey.)

Tested via `jest + @testing-library/user-event` tab simulation and a manual Chromium `Tab` walkthrough. The separate recording file `frontend/tests/a11y-keyboard-walkthrough.md` was never added to the repo; this section is the only written record.

## Screen-Reader Spot Checks (recorded 2026-08-31)

| Flow | Tool | Result |
|---|---|---|
| Create trade wizard | NVDA 2024.4 + Firefox, VoiceOver + Safari | All labels announced, slider `valuetext` reads "Buyer absorbs 40 percent", errors announced via polite live region, modal titles announced as dialog |
| Trade list + deposit | VoiceOver | Card aria-label "View trade t-1 — Maize 10,000 cNGN, status PENDING" announced; buttons announced as "Deposit for trade t-1, button" |
| Video upload | NVDA | Drop zone "Upload delivery proof video — drag and drop or press Enter to browse, button" announced; progress not interruptive |
| Admin clawback | NVDA | CurrencyInput label "Clawback amount" + helper "Remaining vested: 1000" announced via describedby; error polite |
| Vault manage | VoiceOver | Custom dialog `role="dialog" aria-modal="true"` trapped focus correctly (fixed from document-wide query) |

No critical/serious axe violations remain; minor contrast warnings require manual verification (gold-on-dark passes AA for large text, fails for small — design token `text-gold` now only for large/bold).

## Before/After Scores

| Metric | Before (2026-06-29) | After (2026-08-31) |
|---|---|---|
| Automated axe tests | 14 | 28+ |
| Critical/serious violations | 6 (3 trade/admin, 3 form) | 0 |
| Keyboard-only create→release | ❌ Blocked (window.prompt, slider, card) | ✅ Pass |
| CI blocking | ❌ Implicit via `pnpm test` | ✅ Explicit `a11y axe audit` job fails PR |
| Manual color-contrast | Not verified | Verified large text AA; small gold flagged for follow-up |

## Test Location

- `frontend/src/__tests__/accessibility/components.axe.test.tsx` (original 14)
- `frontend/src/__tests__/accessibility/moneyFlows.axe.test.tsx` (CurrencyInput, VideoUploadCard, ConfirmActionModal, TradeListItem keyboard)
- `frontend/src/__tests__/accessibility/routes.axe.test.tsx` (all routes baseline)
- `frontend/src/components/ui/__tests__/Breadcrumbs.test.tsx`, `ConfirmActionModal.test.tsx` (existing)

Run with:
```bash
pnpm test -- src/__tests__/accessibility --verbose
# CI: .github/workflows/ci.yml → "A11y axe audit (blocking)"
```

## Audit Trail

- Baseline recorded at `frontend/docs/accessibility-report.md#baseline---all-routes-2026-08-31`
- CI gate: `.github/workflows/ci.yml`, step "A11y axe audit (blocking)" (`pnpm test -- src/__tests__/accessibility --verbose`)
- Keyboard script: this file (there is no separate `frontend/tests/a11y-keyboard-walkthrough.md`)
- Screen-reader log: table above


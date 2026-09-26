# Admin Screens — Mobile

This document describes the admin-facing components and screens available in the mobile app.

---

## ClawbackHelpBanner

**Location:** `mobile/src/components/ClawbackHelpBanner.tsx`

A reusable, collapsible help banner designed for admin onboarding flows and token-stream management screens.

### Purpose

Provides in-context guidance about clawback semantics so admins understand the consequences of the action before confirming. The banner is collapsed by default to avoid UI clutter and can be toggled open with a single tap.

### Key behaviour

- **Collapsed by default** — only the "What is a clawback?" row is visible.
- **Press to expand/collapse** — the toggle button (`testID="clawback-help-toggle"`) cycles the panel.
- **Accessible** — `accessibilityRole="button"` and a descriptive `accessibilityLabel` update dynamically with state.

### Usage

```tsx
import { ClawbackHelpBanner } from '../components/ClawbackHelpBanner';

// Drop inside any admin screen, above the clawback action button:
<ClawbackHelpBanner />
```

---

## Error and empty states

Every admin screen except `AdminStreamScreen` renders backend failures through `viewForError` and `AdminErrorBanner`; the full code-to-action table lives in `mobile/docs/admin-errors.md`. Each screen also gates on `role === 'admin'` first: a non-admin sees "Admin access required" with a "Go back" button and no request is fired.

| Screen | Error state | Empty state | Other states |
| --- | --- | --- | --- |
| `AdminStreamsOverviewScreen` | Load failure sets `errorView`; the banner's retry re-runs `loadStreams`. | An empty API result renders an empty list with no message. The seeded stream list shows until the first response lands. | "Loading streams…" row while fetching. An `OfflineBanner` shows when `useNetworkStatus` reports offline and the Clawback / Lock / Terminate buttons are disabled. |
| `AdminTradesBatchScreen` | A failed submit sets `actionErrorView`; retry re-fires the batch and the trade IDs and target status are kept. `loadErrorView` is never set today (no fetch on mount). | No results card until a batch has run. An empty ID list is ignored client-side and the run button stays disabled. | Per-trade `failed` rows from a successful response are listed in the result card, not the banner. |
| `AdminContractScreen` | Separate `medErrorView` (add mediator) and `feeErrorView` (fee update) banners; retry re-fires that section only and its input is kept. | No XDR card until a request succeeds. | A fee outside 1–500 bps, or a blank mediator address, is ignored client-side without a banner. |
| `AdminFeaturesScreen` | A failed load sets `loadErrorView` (retry reloads flags). A failed toggle rolls the switch back and sets `rowErrorView`; the banner's retry does nothing for a toggle failure, so the admin flips the switch again. | "No feature flags defined." | "Loading flags…" row until the first response. |
| `AdminActionSuccessScreen` | None; it only reads the session history store. | "No previous actions recorded." when the history is empty. | |
| `AdminStreamScreen` | Not registered in `AppNavigator`. Load failure shows the raw error message (or "Failed to load audit trail") with a Retry button; it does not use `AdminErrorBanner`. | "No audit records found". | Full-screen "Loading audit trail…" indicator. |

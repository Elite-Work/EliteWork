# Mobile Admin Error Handling

The mobile app translates every backend admin (and generic) error into a
typed `AdminApiError` and renders it through a single `AdminErrorBanner`
component. This keeps users out of generic "something went wrong" message
dead-ends and instead tells them what to do next.

## At a glance

| Layer | File | Purpose |
| --- | --- | --- |
| Typed error class | `mobile/src/api/errors.ts` | `AdminApiError` + `AdminErrorView` types. |
| Backend code → view map | `mobile/src/api/adminErrorMap.ts` | The full `code` → title/message/action table. |
| Axios interceptor | `mobile/src/api/errorInterceptor.ts` | Catches Axios errors, normalizes them, exports `viewForError`. |
| HTTP client wiring | `mobile/src/api/client.ts` | Registers the response interceptor. |
| Banner component | `mobile/src/components/AdminErrorBanner.tsx` | Inline, accessible, action-driven banner. |
| Shared mailto | `mobile/src/constants/support.ts` | `SUPPORT_EMAIL` + `buildSupportMailto(view, screenName)` reused by every admin + store consumer. |
| Screen integration | `mobile/src/screens/AdminStreamsOverviewScreen.tsx` | Streams list with SEED fallback + banner. |
| Screen integration | `mobile/src/screens/AdminTradesBatchScreen.tsx` | Batch trade-status update with banner on action. |
| Screen integration | `mobile/src/screens/AdminContractScreen.tsx` | Contract mediators + fee update with per-section banner. |
| Screen integration | `mobile/src/screens/AdminFeaturesScreen.tsx` | Feature-flag toggle with optimistic update + rollback banner. |
| Store integration | `mobile/src/stores/tradeStore.ts` | Dual-slot error store (`errorView` for load, `lastActionErrorView` for mutations) — catch blocks route through `viewForError`. |
| Consumer screen | `mobile/src/screens/VaultDashboard.tsx` | Reads `errorView` from the store and renders `<AdminErrorBanner>` with one read. |
| Admin API | `mobile/src/api/admin.ts` | Typed wrappers around all admin endpoints. |
| Navigation | `mobile/src/navigation/AppNavigator.tsx`, `mobile/src/types/navigation.ts` | Registers all four admin screens in the root stack. |
| Tests | `mobile/src/api/adminErrorMap.test.ts` + `errorInterceptor.test.ts` + `AdminErrorBanner.test.tsx` + `AdminStreams/Trades/Contract/FeaturesScreen.test.tsx` + `tradeStore.test.ts` | Unit + integration tests across the mapping, interceptor, banner, screens, and store. |

## Admin screens at a glance

Each admin screen follows the same pattern: typed API wrapper, role gate, dual-state error slots (`loadErrorView` for initial GET, `actionErrorView`/`sectionErrorView`/`rowErrorView` for submit-time failures), and `viewForError(error) → AdminErrorView → AdminErrorBanner`.

| Screen | Endpoints | Error slot model | Notes |
| --- | --- | --- | --- |
| `AdminStreamsOverviewScreen` | `GET /admin/streams` (list) | `errorView` (single) | SEED list rendered before fetch resolves. Shows `OfflineBanner` and disables the action buttons while offline. |
| `AdminTradesBatchScreen` | `POST /admin/trades/batch/status` | `actionErrorView` (single) | Banner's retry button re-fires the batch with the same text input. Inputs survive error. |
| `AdminContractScreen` | `POST /admin/contract/mediators`, `PATCH /admin/contract/fee` | per-section (`medErrorView`, `feeErrorView`) | Each section has its own banner so failure on one doesn't block the other. Surfaces `unsignedXdr` for the admin to sign externally (TODO: wire Freighter). |
| `AdminFeaturesScreen` | `GET /admin/features`, `PATCH /admin/features/:name` | `loadErrorView` + `rowErrorView` | Switch uses optimistic update; rolls back to the previous value on PATCH failure so the UI matches the backend. The banner's retry only reloads after a failed load; after a failed toggle the admin flips the switch again. |

See `mobile/src/screens/ADMIN_SCREENS.md` for each screen's error and empty states. `AdminStreamScreen` (audit trail, not registered in `AppNavigator`) predates this pattern and still shows a plain error message with a Retry button instead of `AdminErrorBanner`.

## How it flows

```
axios request
    │
    ▼
adminErrorResponseErrorInterceptor (client.ts)
    │
    ├── 401/403 → AUTH_ERROR view (sign_out_required)
    ├── 429     → wait_then_retry view with Retry-After
    ├── 5xx     → mapAdminErrorCode(code)
    ├── ECONNABORTED → TIMEOUT_ERROR → retry
    └── no response → NETWORK_ERROR → retry
    │
    ▼
catch (AdminApiError e)
    │
    ▼
viewForError(e)  ──►  AdminErrorView { title, message, action, retryAfterSeconds?, requestId? }
    │
    ▼
<AdminErrorBanner view={...} onRetry onSignOut onGoBack onContactSupport />
```

## Backend code → friendly action table

The mapping lives in `mobile/src/api/adminErrorMap.ts`. If you add a new
code on the backend, add it here and the screen picks it up with zero
changes.

| Backend code | Title | Action |
| --- | --- | --- |
| `AUTH_ERROR` | Admin access required | `sign_out_required` |
| `TRADE_ACCESS_DENIED` | Not allowed | `contact_support` |
| `ADMIN_QUOTA_EXCEEDED` | Too many admin actions | `wait_then_retry` (`retryAfterSeconds`) |
| `RATE_LIMIT_EXCEEDED` | Slow down | `wait_then_retry` |
| `ADMIN_OPERATION_TIMEOUT` | Network timed out | `retry` |
| `PAYMENT_PROVIDER_TIMEOUT` | Network timed out | `retry` |
| `NOT_FOUND` / `TRADE_NOT_FOUND` / `DISPUTE_NOT_FOUND` | Not found | `go_back` |
| `DOMAIN_ERROR` / `TRADE_INVALID_STATUS` / `DISPUTE_STATUS_TRANSITION_INVALID` | Action not allowed | `refresh` |
| `DISPUTE_STATUS_CONFLICT` | Already updated | `refresh` |
| `DISPUTE_INVALID_CATEGORY` | Invalid category | `dismiss` |
| `VALIDATION_ERROR` | Check your input | `dismiss` |
| `CLAWBACK_INVALID_AMOUNT` | Invalid amount | `dismiss` |
| `CLAWBACK_TOO_LARGE` | Amount too large | `dismiss` |
| `PAYMENT_INSUFFICIENT_FUNDS` | Not enough balance | `contact_support` |
| `PAYMENT_PROVIDER_ERROR` | Payment service unavailable | `wait_then_retry` |
| `INFRA_ERROR` | Service unavailable | `wait_then_retry` |
| `INTERNAL_ERROR` | Something went wrong | `contact_support` |
| `TRADE_BUILD_FAILED` | Couldn't build transaction | `contact_support` |
| *unknown* | Something went wrong | `contact_support` |
| `NETWORK_ERROR` *(mobile-only)* | You appear to be offline | `retry` |
| `TIMEOUT_ERROR` *(mobile-only)* | The request timed out | `retry` |

## 403 handling

The axios interceptor maps **both** `401` and `403` to the friendly
`AUTH_ERROR` view with a `sign_out_required` action. Screens that already
have a local role gate (e.g. `AdminStreamsOverviewScreen`) short-circuit
*before* the request fires when the role is wrong, so a real-world 403
typically means token drift, not a UI-level access check. The banner
gives the user a one-tap sign-out path and a "Contact support" link that
includes the backend `requestId` so support can correlate logs.

## Network failure handling

When axios has **no response** (offline, DNS failure, CORS), we synthesise
a `NETWORK_ERROR AdminApiError` with a `retry` action instead of
forwarding the raw axios blob. `ECONNABORTED` (timeout) is mapped to
`TIMEOUT_ERROR` with the same retry action. In both cases the user sees
"Check your connection and try again" rather than "Network Error".

## Use in screens

```ts
import { adminApi } from '../api/admin';
import { viewForError } from '../api/errorInterceptor';
import { AdminErrorBanner } from '../components/AdminErrorBanner';

const [errorView, setErrorView] = useState<ReturnType<typeof viewForError> | null>(null);

async function load() {
  try {
    await adminApi.listStreams();
  } catch (e) {
    setErrorView(viewForError(e));
  }
}

{errorView ? (
  <AdminErrorBanner
    view={errorView}
    onRetry={load}
    onSignOut={handleSignOut}
    onGoBack={() => navigation.goBack()}
    onContactSupport={() => Linking.openURL(
      `mailto:support@amana.example?subject=Admin error&body=Request%20id:%20${errorView.requestId}`,
    )}
  />
) : null}
```

## Adding a new error code

1. Drop a new `ErrorCode` constant into `backend/src/errors/errorCodes.ts`
   and throw it from the relevant service / route.
2. Extend the `AppError` to include `retryAfterSeconds` etc. in `details`
   if the UI should show a wait hint.
3. Add the `code` → view entry to `ADMIN_ERROR_MAP` in
   `mobile/src/api/adminErrorMap.ts` with `title`, `message`, and
   `action` (`retry` / `wait_then_retry` / `contact_support` /
   `sign_out_required` / `refresh` / `go_back` / `dismiss`).
4. Add a unit test in `mobile/src/api/adminErrorMap.test.ts`.
5. Update the table at the top of this doc.

## Store-level error pattern

`mobile/src/stores/tradeStore.ts` is the first Zustand store migrated to the `AdminErrorView` pattern. Each catch block passes the raw error through `viewForError(error)` (or the fallback in `errorInterceptor.ts`) and persists the resulting view on the store. Screens render the banner with one read:

```ts
const { trades, isLoading, errorView, fetchTrades } = useTradeStore();
return (
  <View>
    {errorView ? <AdminErrorBanner view={errorView} onRetry={fetchTrades} /> : null}
    {/* ... */}
  </View>
);
```

The store keeps **two error slots** to mirror the dual-state pattern used by the admin screens:

| Slot | When written | When read |
| --- | --- | --- |
| `errorView` | Load actions (`fetchTrades`, `fetchTrade`) | List screens (`VaultDashboard`) render above the content. |
| `lastActionErrorView` | Mutation actions (`createTrade`, `confirmDelivery`, `releaseFunds`, `deposit`, `initiateDispute`) | Detail / action screens render near the trigger button. |

A successful `fetchTrades` clears `errorView` but leaves `lastActionErrorView` untouched so an earlier mutation banner survives a background refresh. `clearErrorView()` drops both slots, and is the only error-clearing entry point on the store.

Consumer screens (`VaultDashboard`, `TradeListScreen`, `TradeDetailScreen`) read directly from the store and render `<AdminErrorBanner view={…}>` — the screens now treat `errorView` / `lastActionErrorView` as the canonical shape. No deprecated string-typed aliases remain: if you find yourself reaching for one, read the corresponding slot above instead.

Test assertions target `errorView.action` / `errorView.code`, **not** the message text, so future mapper tweaks don't silently break tests (`mobile/src/stores/tradeStore.test.ts`).

### Adding a new action to the store

1. Wrap the API call in `try { ... } catch (e) { set({ lastActionErrorView: viewForError(e) }); }` (mutation) or `set({ errorView: viewForError(e) })` (load).
2. Choose the right slot — mutations go to `lastActionErrorView`, reads go to `errorView`, or fork a third if another category emerges.
3. On the screen, render `<AdminErrorBanner view={store.errorView}` (or `lastActionErrorView`) with the appropriate callback.
4. Add a unit test asserting `result.lastActionErrorView?.action === '…'` for at least one happy-path + one error-path case.

## Tests

Run the mapping + interceptor + banner + per-screen tests with:

```
cd mobile
pnpm test adminErrorMap.test errorInterceptor.test AdminErrorBanner.test AdminStreamsOverviewScreen.test AdminTradesBatchScreen.test AdminContractScreen.test AdminFeaturesScreen.test
```

The tests cover (at minimum):
- `ADMIN_QUOTA_EXCEEDED`, `ADMIN_OPERATION_TIMEOUT`, `AUTH_ERROR`,
  `CLAWBACK_TOO_LARGE`, `CLAWBACK_INVALID_AMOUNT`, `NOT_FOUND`,
  `INTERNAL_ERROR`, `RATE_LIMIT_EXCEEDED`, `PAYMENT_INSUFFICIENT_FUNDS`,
  `TRADE_ACCESS_DENIED`, `DISPUTE_STATUS_TRANSITION_INVALID`,
  `VALIDATION_ERROR`, and the unknown-code fallback.
- Network / timeout fallback (`NETWORK_ERROR`, `TIMEOUT_ERROR`).
- 401 / 403 mapping, 429 with `Retry-After` header.
- Component rendering for every action and the `requestId` propagation.
- Per-screen: role gate (non-admin → access message), happy-path
  submit showing the typed response, `NETWORK_ERROR` / structured
  backend error producing the banner, and (where applicable) retry
  re-firing the request.

## Acceptance criteria

- ✅ Specific admin error codes show clear retry or contact support guidance.
- ✅ Mobile UI handles 403 and network failures gracefully.
- ✅ Tests verify error mapping logic.
- ✅ Documentation lists mobile admin error handling *(this file)*.

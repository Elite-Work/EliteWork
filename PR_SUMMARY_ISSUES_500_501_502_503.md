# feat: cursor-paginated trade list with infinite scroll + downloadable/shareable trade receipts

Closes #500
Closes #501
Closes #502
Closes #503

## Summary

Four linked issues, split by package so each part can be reviewed on its own.
#500 and #501 both depended on a backend receipt endpoint that did not exist
yet (`GET /api/trades/:id/receipt`), so that endpoint ships here as the shared
dependency.

| Issue | Area | What shipped |
| --- | --- | --- |
| #502 | backend | Cursor pagination (`cursor` + `limit`, `pageInfo.nextCursor`) on `GET /api/trades`, documented in OpenAPI, with the legacy `page` path kept and marked deprecated |
| #503 | frontend | Infinite scroll on the trades list using react-query `useInfiniteQuery`, with the watchlist-first ordering preserved end to end |
| #500 | backend + frontend | `GET /api/trades/:id/receipt` returns the receipt PDF; trade-detail page shows a **Download Receipt** button for completed and disputed trades |
| #501 | mobile | Native share-sheet button on the trade-detail screen for completed and disputed trades, sharing the receipt link |

---

## #502 — backend: cursor pagination for `GET /api/trades`

### API

```
GET /api/trades?limit=20
GET /api/trades?limit=20&cursor=<opaque-token-from-previous-response>
```

Cursor-mode response (now the default):

```json
{
  "items": [ ... ],
  "pageInfo": {
    "nextCursor": "eyJpZCI6NDIsInNlZ21lbnQiOiJ1bndhdGNoZWQifQ",
    "hasNextPage": true,
    "limit": 20
  }
}
```

- `cursor` is opaque; clients must pass `pageInfo.nextCursor` back verbatim.
- `hasNextPage` is computed with a `limit + 1` lookahead, so the client never
  needs an extra empty request to discover the end.
- A malformed/tampered cursor returns `400 { "error": "Invalid pagination cursor" }`
  instead of a 500, via the shared `InvalidCursorError`.

### Backward compatibility

- Existing clients that still send `page` (and no `cursor`) get the exact old
  `{ items, pagination: { page, limit, total, totalPages } }` envelope and a
  `Warning: 299 - "page/limit offset pagination is deprecated; ..."` header.
- Cursor always wins if both are supplied. No behavioural change for the
  `status`, `sort`, `q`, or access-scoping filters.

### Watchlist-first ordering with cursors

`TradeService.listUserTrades` merges two sources: the caller's watchlisted
trades (promoted to the top) and the rest. A single offset/key cannot express
"position in source A, then source B", so the cursor carries an opaque
`segment` (added as an optional field on the shared `CursorKey` codec):

- `segment: "watched"` — anchored to the **watchlist row's** `(createdAt, id)`,
  not the trade's. This keeps the page boundary stable even if the user
  un-watchlists the boundary trade between requests.
- `segment: "unwatched"` — anchored to the trade `id` through the existing
  shared `paginateWithCursor` helper.

A page starts in the watched segment and spills into the unwatched segment once
the watchlist is exhausted, which is exactly the legacy ordering. `hasNextPage`
on a full watched page also probes for a first unwatched trade so the client is
not told "more" or "done" incorrectly.

### Files

- `backend/src/services/trade.service.ts` — cursor mode, watchlist segment
  cursors, `listWatchedEntries`, `isWatchedEntryAfterCursor`, legacy fallback.
- `backend/src/schemas/trade.schemas.ts` — `cursor` query param; `page` loses
  its default so its absence can select cursor mode.
- `backend/src/routes/trade.routes.ts` — forwards `cursor`, maps
  `InvalidCursorError` to 400, sets the deprecation `Warning` header.
- `backend/src/lib/cursorPagination.ts` — optional `segment` in the cursor
  payload (ignored by `paginateWithCursor`).
- `backend/src/docs/openapi.yaml` + `openapi.json` — `ListTradesCursorQuery`,
  deprecated `page`, `pageInfo`/`pagination` on `TradeListResponse`.
- `backend/docs/cursor-pagination.md` — replaces the old "intentionally not
  migrated" note with the watchlist-segment design.
- `backend/src/__tests__/trade.pagination.test.ts` (new), plus updated
  `trade.service.test.ts`, `trade.routes.test.ts`, `openapi.docs.test.ts`,
  `openapi.drift.test.ts`.

---

## #500 — backend + frontend: trade receipt download

### Backend

```
GET /api/trades/:id/receipt   (bearer auth)
```

- Reuses the existing `tradeReceipt.service.ts` PDF renderer (trade id, parties,
  amount, status, timestamps, QR link to the settlement tx or a stellar.expert
  lookup fallback).
- Looks up the latest confirmed `payoutIntent.txHash` so the QR points at the
  on-chain settlement when one exists.
- Any party to the trade may fetch it; non-parties get `403`, unknown trades
  `404`. Rate-limited with the existing `RATE_LIMIT_CONFIG.tradeExport` limiter.
- Responds with `Content-Type: application/pdf` and
  `Content-Disposition: attachment; filename="trade-<id>-receipt.pdf"`.
- Documented in OpenAPI (`/trades/{id}/receipt`, binary response) and covered by
  route tests for 200/403/404.

### Frontend

- `api.trades.downloadReceipt(token, id)` fetches the PDF as a Blob (the shared
  `request` helper is JSON-only) and throws `ApiError` on failure.
- Trade-detail page renders **Download Receipt** (`data-testid="action-download-receipt"`)
  only when the trade is `COMPLETED` or `DISPUTED`, and only for a party to the
  trade. Clicking it saves `trade-<id>-receipt.pdf`; failures surface inline.
- Tests cover visibility per status, the download/save flow, and error display.

### Files

- `backend/src/routes/trade.routes.ts` — receipt route.
- `backend/src/docs/openapi.yaml` + `openapi.json` — receipt path.
- `backend/src/__tests__/trade.routes.test.ts` — receipt 200/403/404.
- `frontend/src/lib/api/trades.ts`, `frontend/src/lib/api/types.ts`.
- `frontend/src/app/trades/[id]/page.tsx`.
- `frontend/src/__tests__/TradeDetailPage.test.tsx`.

---

## #503 — frontend: infinite scroll on the trades list

### Behaviour

- The full-list fetch was replaced with `useInfiniteQuery` from
  `@tanstack/react-query` (added as a frontend dependency, 5.108.4; the repo
  already used `@tanstack/react-virtual` for the list itself).
- A new app-wide `QueryProvider` mounts the client once at the root (cache
  survives navigation; Fast Refresh does not recreate it).
- Query key is `["trades", status, search]`, so changing the filter tab or the
  300 ms-debounced search resets the loaded pages and fetches page one again.
- `getNextPageParam` returns `pageInfo.nextCursor` only while
  `pageInfo.hasNextPage` is true.
- `VirtualizedList` gained `onEndReached` / `endReachedOffset` / `footer`
  props. Reaching within 120 px of the bottom calls `fetchNextPage()`; the in-list
  footer shows `Loading more trades…`, a **Load more trades** fallback button
  (keyboard/AT users, and short lists), or `End of trades`.
- Duplicate fetches are guarded by checking `isFetchingNextPage`; `hasNextPage`
  false stops the requests entirely.
- Removed the old page-number state and Previous/Next pagination controls.

### Files

- `frontend/src/app/trades/page.tsx`.
- `frontend/src/components/QueryProvider.tsx` (new), `frontend/src/app/layout.tsx`.
- `frontend/src/components/ui/VirtualizedList.tsx`.
- `frontend/src/lib/api/trades.ts`, `frontend/src/lib/api/types.ts`
  (`TradeListPageInfo`, optional legacy `pagination`).
- `frontend/package.json` / `pnpm-lock.yaml`.
- Tests: `frontend/src/__tests__/tradesInfiniteScroll.test.tsx` (new) and
  `tradesSearch.test.tsx` (wrapped in a `QueryClientProvider`; whitespace-only
  search now correctly issues **no** refetch because it trims to the same key).

---

## #501 — mobile: receipt share sheet on trade detail

- `buildApiUrl()` is now exported from `mobile/src/api/client.ts` (the request
  interceptor reuses it, so version-prefix behaviour is identical), and
  `buildTradeReceiptUrl(tradeId)` builds the absolute receipt URL.
- Trade-detail screen shows **🧾 Share Receipt** (`testID="trade-share-receipt"`)
  for `COMPLETED` and `DISPUTED` trades.
- Pressing it calls React Native's `Share.share` with the receipt link, which
  opens the native iOS/Android share sheet. A failure shows a clear alert rather
  than crashing.
- Tests updated: the per-status action matrix now expects Share on completed and
  disputed trades (and no "no actions" placeholder for completed), plus new
  assertions that `Share.share` receives the receipt URL on both statuses.

### Files

- `mobile/src/screens/TradeDetailScreen.tsx`.
- `mobile/src/api/client.ts`, `mobile/src/api/trade.ts`.
- `mobile/src/screens/TradeDetailScreen.test.tsx`.

---

## Validation

Run from the repo root.

```bash
# Backend — trade list, receipt, cursor codec, OpenAPI docs
cd backend
npx prisma generate
pnpm exec jest --config jest.config.js --runInBand --coverage=false \
  src/__tests__/trade.pagination.test.ts \
  src/__tests__/trade.service.test.ts \
  src/__tests__/trade.routes.test.ts \
  src/__tests__/openapi.docs.test.ts \
  src/__tests__/cursorPagination.test.ts \
  src/__tests__/tradeReceipt.service.test.ts
# → 6 suites passed, 52 tests passed

# Search-list behaviour also updated for the cursor envelope:
pnpm exec jest --config jest.config.js --runInBand --coverage=false \
  src/__tests__/trade.search.service.test.ts
# → suite passes (its empty-result test now asserts the cursor envelope)

# The drift suite is blocked at type-check time by a pre-existing
# `stellar.ledger.ts` (`LedgerRecord.total_operations`) error that this change
# does not touch. Its assertions were verified with ts-jest diagnostics off:
pnpm exec jest --config jest.config.js --runInBand --coverage=false \
  --globals '{"ts-jest":{"diagnostics":false}}' \
  src/__tests__/openapi.drift.test.ts
# → 1 suite passed, 46 tests passed

# Frontend — full suite (acceptance criterion for #500 and #503)
cd frontend
pnpm test
# → 110 suites passed, 1310 tests passed, exit 0

# Mobile — trade-detail screen
cd mobile
pnpm exec tsc --noEmit          # clean
pnpm exec jest --runInBand src/screens/TradeDetailScreen.test.tsx
# → 1 suite passed, 42 tests passed
```

ESLint on the changed source files reports no errors (only pre-existing
warnings in `trade.routes.ts` / `trade.service.ts`).

### Known/unrelated limitations

- `pnpm exec tsc --noEmit` still reports pre-existing errors (frontend
  `Step3Review.test.tsx`, backend `stellar.ledger.ts`, `mockFactories.ts`,
  etc.). None are in files changed here; backend OpenAPI drift runs with
  transpile-only diagnostics because of the `stellar.ledger.ts` one.
- `src/__tests__/schemas.formatter.test.ts` has 9 pre-existing failures in the
  untouched `createTradeSchema` group (amount formatting, key validation,
  `PENDING_DEPOSIT` enum). The two `listTradesQuerySchema` assertions affected
  by this change were updated and pass.
- The mobile receipt link is the authenticated API URL. Sharing it hands over a
  link that still requires the recipient's own session to download; a public,
  signed share token would be a follow-up if receipt forwarding to third
  parties is wanted.
- Offset callers elsewhere (`assets`, `dashboard`, `vault`, mobile trade list)
  keep working: they either pass `page` (legacy envelope) or read only `items`
  (cursor page one).

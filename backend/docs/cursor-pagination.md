# Cursor Pagination

## Overview

High-volume list endpoints (audit log, webhook delivery logs, and future
migrations) are moving from offset pagination (`page`/`limit`) to
**cursor-based pagination**. Offset pagination gets slow on deep pages and
can silently duplicate or drop rows when the underlying table is written to
between page fetches — a real problem for tables like `AdminActionAudit` and
`WebhookDeliveryAttempt` that are appended to continuously.

Cursor pagination anchors each page to the last row actually returned
(via Prisma's `cursor`/`skip: 1`) instead of a numeric offset, so results
stay stable under concurrent inserts.

Shared implementation: [`src/lib/cursorPagination.ts`](../src/lib/cursorPagination.ts).

## Using the new API

```
GET /api/admin/audit?limit=20
GET /api/admin/audit?limit=20&cursor=<opaque-token-from-previous-response>
```

Response shape:

```json
{
  "items": [ ... ],
  "pageInfo": {
    "nextCursor": "eyJpZCI6NDJ9",
    "hasNextPage": true,
    "limit": 20
  }
}
```

`cursor` is an opaque, base64url-encoded token — do not parse or construct it
client-side. Treat it as a bookmark and pass it back verbatim to fetch the
next page. There is no `prevCursor`/backward pagination in this first pass;
endpoints that need it (e.g. an interactive table with a "previous" button)
should re-request from the start with a stored trail of cursors, or wait for
a future backward-cursor addition.

## Backward compatibility

Existing clients that still send `page`/`limit` continue to work exactly as
before — the endpoint falls back to offset pagination and responds with the
legacy `pagination: { page, limit, total, totalPages }` envelope. These
requests also get a `Warning: 299 - "page/limit offset pagination is
deprecated; use cursor/pageInfo.nextCursor instead"` response header.

This compatibility path is meant to be temporary. Once dependent clients
(frontend, mobile, third-party API consumers) have migrated to `cursor`, the
`page` handling and `pagination` field should be removed from these
endpoints.

## Migrated endpoints

- `GET /api/admin/audit` ([adminAudit.service.ts](../src/services/adminAudit.service.ts))
- `GET /webhooks/:id/logs` ([webhooks.logs.routes.ts](../src/routes/webhooks.logs.routes.ts))
- `GET /api/trades` ([trade.service.ts](../src/services/trade.service.ts), #502)

### `GET /trades` and watchlist-first ordering

The trades list is a merge of two sources: the caller's watchlisted trades
(promoted to the top) and everything else. A single key cannot express
"position in source A, then source B", so the trade cursor carries an extra
opaque `segment` field:

- `segment: "watched"` — anchored to the watchlist row's `(createdAt, id)`, so
  a page boundary survives the trade being un-watchlisted mid-scroll.
- `segment: "unwatched"` — anchored to the trade `id` via the shared
  `paginateWithCursor` helper.

A page starts in the watched segment and spills into the unwatched one once
the watchlist is exhausted, preserving the legacy "watched first" semantics.
`page` is still accepted without a cursor and returns the legacy `pagination`
envelope plus a deprecation `Warning` header; the frontend infinite scroll
(#503) is the first client on the cursor path.

## Adding cursor pagination to a new endpoint

1. Ensure the underlying model has a unique, indexed `id` (or add one).
2. Order by `[<sortField>, { id: "desc" }]` — the trailing `id` tiebreaker
   keeps ordering deterministic when the primary sort field has duplicates.
3. Call `paginateWithCursor({ findMany, orderBy, cursor, limit })`.
4. If the endpoint has existing offset-pagination clients, keep a `page`
   fallback branch (see `adminAudit.service.ts` for the pattern) and set the
   deprecation `Warning` header from `CURSOR_DEPRECATION_WARNING`.

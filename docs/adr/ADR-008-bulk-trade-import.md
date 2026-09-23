# ADR-008: Bulk Trade Import

## Status

Accepted (implemented in `POST /trades/bulk` —
`backend/src/routes/trade.routes.ts`, `TradeController.createBulkTrades`,
`bulkTradeBodySchema` in `backend/src/schemas/trade.schemas.ts` — and the
minimal UI at `frontend/src/app/cooperative/bulk-import/page.tsx` with CSV
parsing in `frontend/src/lib/bulkImport.ts`).

## Context

Cooperative admins onboard many smallholder farmers at once; creating trades
one at a time through the UI does not scale to a spreadsheet of members.
The existing `POST /trades` path (`authMiddleware → idempotencyMiddleware →
createTradeSchema → createTrade`) already encodes the correct semantics —
buyer from JWT, Stellar key checks, stroop-precision amount validation, one
unsigned XDR per trade — so the bulk path should reuse it, not fork it.

Constraints:

1. Row independence — one bad CSV row must not abort the other 49.
2. Same permission as single creation — bulk is batching, not privilege.
3. Bounded cost — each row builds a contract transaction via RPC, so one
   request must not monopolize that path.

## Decision

**Envelope plus per-row results, same validation as single creation:**

- **`POST /trades/bulk` takes `{ trades: [...], cooperativeId?, region? }`**
  with 1–50 rows. Each row is validated by the identical `createTradeSchema`
  (plus the controller's defensive `prepareTradeRow` mirror), and the buyer
  for every row is the JWT caller — rows cannot spoof a different buyer.
- **Rows are independent:** each row runs `buildCreateTradeTx` +
  `createPendingTrade` in its own try/catch. The endpoint always responds
  `200 { created: [{index, tradeId, unsignedXdr}], failed: [{index, error}] }`
  so the importer retries just the failed rows. The whole batch shares one
  `Idempotency-Key`, matching single-trade semantics.
- **Minimal UI:** `/cooperative/bulk-import` (any authenticated wallet, no
  global-admin gate so cooperative admins can reach it) pastes
  `sellerAddress,amountUsdc[,buyerLossBps,sellerLossBps]` CSV, previews the
  client-side parse with per-line errors, submits with an idempotency key,
  and renders created/failed rows. CSV parsing is a pure helper
  (`parseBulkCsv`) covered by unit tests.
- **`cooperativeId`/`region` are metrics labels only** (see ADR-009) —
  they never change trade ownership or bypass validation.

## Consequences

- **Positive:** Validation cannot drift between single and bulk creation —
  both go through `createTradeSchema`, and the parity script still covers
  the shared domain schema.
- **Positive:** Partial success is a first-class response, which is what a
  spreadsheet workflow needs (fix two rows, resubmit two rows).
- **Negative:** 50 sequential contract builds per request is slow for very
  large cohorts; larger imports should be split client-side (the UI states
  the cap) rather than raising it server-side.
- **Negative:** No CSV file upload yet — paste-only keeps the UI dependency-
  free, at the cost of an extra copy/paste step for sheet users.

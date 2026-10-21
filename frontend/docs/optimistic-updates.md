# Optimistic Updates — Store, Toast Contract & Dedup

**Date:** 2026-08-31

## Store — snapshot-based rollback

- `src/stores/tradeStore.ts` — `updateTrade` / `updateTradeOptimistic` / `removeTrade`:
  - Snapshot deep clone before patch (`prevTrades`, `snapshot` for target id).
  - Apply optimistic patch immediately, store `pendingActions {correlationId, idempotencyKey}`.
  - On `serverFn` success: clear pending.
  - On failure-mid-flight: restore **exact prior UI state** from snapshot (or full `prevTrades` if no snapshot). Tests in `tradeStore.optimistic.test.ts` prove restoration.
- No regression: `fetchTrades`/`setPage`/`setFilter` remain synchronous to server; optimistic only for `update/remove`.

## Unified toast contract: success/error/pending w/ correlation IDs

- `src/hooks/useToast.tsx` — `ToastProvider` now exposes:
  - `addToastWithCorrelation({type, message, correlationId})` — dedups pending toasts by correlation, pending duration 0 (sticky).
  - `updateToast(correlationId, patch)` — mutates same toast from pending → success/error.
  - `dismissByCorrelation`
  - `TOAST_CONTRACT.pending/success/error` helpers (reviewed for consistency).
- Inventory: all mutations use pending (info) → success (success) or error (error) with same correlationId, so rapid retries do not stack. See `toast.contract.test.tsx`.

## Action de-duplication window preventing double-submit

- `src/lib/actionDedup.ts` — 3s window (`DEDUP_WINDOW_MS=3000`) per `actionKey` (`update:{tradeId}:{patch}`, `create-trade:{seller}:{amount}` etc).
  - `shouldDedup(key)` checks map; `registerAction` stores `correlationId`+`idempotencyKey`+timestamp, auto-expires.
  - `Step3Review.handleSubmit` checks `shouldDedup` before any network + `submittingRef`, so rapid triple-click yields single `serverFn` call (verified in `tradeStore.optimistic.test.ts`).
  - Server also confirms once via `Idempotency-Key` header (`generateIdempotencyKey` reused on replay).

## Integration with offline queue precedence

- While online: optimistic store + dedup + toast contract drive UI.
- While offline: no optimistic patch; action enqueued to `offlineQueueStore` with same idempotencyKey/correlationId, banner shows pending count. See `offline-resilience.md`.

## Store tests covering failure-mid-flight sequences

- `src/__tests__/tradeStore.optimistic.test.ts` — forced-failure restores exact prior UI state, success keeps patch, remove rollback, triple-click dedup.
- `src/__tests__/toast.contract.test.tsx` — pending→success updates same toast, dedup same correlation.

## No regression in actual mutation correctness

- All existing `src/__tests__/tradeStore.test.ts` scenarios still pass (fetch, setPage, setFilter, addTrade, update/remove happy path). New `pendingActions` is additive, not breaking.
- `lib/api/trades.ts` now accepts optional `{idempotencyKey, correlationId}` without breaking callers that omit opts.

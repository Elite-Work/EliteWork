# Offline Resilience — Connectivity, Queue & Idempotency

**Date:** 2026-08-31 | Owner: Frontend

## Global connectivity state

- `src/hooks/useOffline.ts` — probes `GET {apiBaseUrl}/health` (no external google.com, CSP-safe) + `navigator.onLine`, interval 5s, 3s timeout. Returns `{isOffline, wasOffline, isOnline, retryOnline}`.
- Surfaced via `src/components/ui/ConnectivityBanner.tsx` fixed top banner (`role="status" aria-live="polite"`):
  - Offline: "You’re offline — actions will be queued…" + pending count + Retry button.
  - Was-offline + queue: "Reconnecting — replaying N…" 
  - Accurate during transition windows (probe + online/offline events).

## Queue idempotent actions locally while offline (draft trades)

- `src/stores/offlineQueueStore.ts` — zustand persist `amana-offline-queue` in localStorage, holds `QueuedAction[] {id, type, endpoint, method, body, idempotencyKey, correlationId, createdAt, attempts}`.
- `TradeContext` draft persists to `localStorage amana:draft-trade` (data + step) — survives refresh/restart.
- `Step3Review` checks `isOffline`: if true, enqueues `create-trade` with generated `idempotencyKey`/`correlationId` via `enqueue`, shows "Queued offline" toast with correlation, does not fire network. Banner shows pending.
- Clear pending UX: `ConnectivityBanner` + `Step3Review` pendingCount badge + `PendingBadge` (exported from `ConnectivityBanner.tsx`) + sr-only hints.

## Replay on reconnect with conflict handling via idempotency keys

- On `!isOffline && wasOffline && queue.length>0`, `ConnectivityBanner` calls `replay(executor)` where executor does `request(endpoint, {method, body, headers: {"Idempotency-Key": key, "X-Correlation-Id": corr}})`.
- Same `idempotencyKey` reused on replay — backend `idempotencyMiddleware` (`backend/src/middleware/idempotency.ts`; response cached under `idempotency:{method}:{path}:{key}`, in-flight lock `idempotency:lock:{method}:{path}:{key}` via `SET NX EX 30`) honors reuse: duplicate-send prevented, cache HIT returns prior response with `X-Idempotency-Cache: HIT`.
- The replay executor does **not** special-case a 409: any error thrown by `request(...)` leaves the action in the queue. Attempts are incremented, failed actions are kept for the next reconnect, and a partial sync toast warns.

## Integration with optimistic store / offline queue precedence

- Precedence: **Offline queue owns mutations while offline**; optimistic store (`tradeStore`) is NOT applied for offline enqueues (no patch). When online, `tradeStore.updateTradeOptimistic` does optimistic patch with snapshot rollback + dedup window + toast correlation. If offline, no optimistic patch — pending banner is source of truth.
- After `replay` settles, `ConnectivityBanner` shows the Synced / Partial sync toast and calls `retryOnline()`. It does not call `fetchTrades` itself, so a list already on screen is reconciled by the page's own fetch or cache revalidation (see `offline-cache-conflict-matrix.md`), not by the replay.

## Tests simulating flaky connectivity (offline -> online mid-flow)

- `src/__tests__/offline.queue.test.tsx` — enqueue persists to localStorage, survives simulated refresh, replay reuses same key, pending UX, E2E offline->online simulation green.
- `src/__tests__/tradeStore.optimistic.test.ts` — failure-mid-flight restores prior UI state, triple-click dedup yields single intent.
- Manual: `Step3Review` with `isOffline=true` enqueues, refresh preserves draft, go online → replay → trade appears once the trade list next refreshes.

Run: `pnpm test -- offline.queue tradeStore.optimistic --verbose`

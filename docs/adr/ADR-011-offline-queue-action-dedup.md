# ADR-011: Offline-Queue Action De-duplication and Idempotency Keys

## Status

Accepted (implemented in `frontend/src/lib/actionDedup.ts`,
`frontend/src/lib/idempotency.ts`, `frontend/src/stores/offlineQueueStore.ts`,
and replayed by `frontend/src/components/ui/ConnectivityBanner.tsx`).

## Context

Amana's mutating calls (create trade, deposit, release, dispute) move money,
so a duplicated request is costly. The web client can produce duplicates in
two independent ways:

1. **Double-submit while online** - a rapid double or triple click on a
   submit button fires the same intent several times before the first
   request settles.
2. **Retry after a lost response or offline gap** - an action is queued
   while the user is offline, or its response is lost, and it is sent again
   on reconnect.

The backend already makes retries safe when the client supplies an
`Idempotency-Key` header (see
[ADR-004](./ADR-004-idempotency-and-retry-strategy.md)). What the client
needs is a consistent way to (a) stop duplicate intents from being issued at
all, and (b) make sure that every send of one logical action, including
replays, reuses the same key.

## Decision

Two cooperating mechanisms, deliberately kept separate.

### 1. Short in-memory de-dup window (`actionDedup.ts`)

- Callers build an **action key** that identifies the intent, for example
  `create-trade:<seller>:<amount>:<buyerLossBps>` in `Step3Review.tsx` or
  `update:<tradeId>:<JSON patch>` and `remove:<tradeId>` in `tradeStore.ts`.
- `shouldDedup(actionKey)` returns `{ dedup: true, entry }` if the same key
  was registered less than `DEDUP_WINDOW_MS` (3000 ms) ago. The caller then
  returns early (or, in `updateTradeOptimistic`, returns the existing
  entry's `correlationId`/`idempotencyKey` instead of starting a new call).
- `registerAction(actionKey, correlationId, idempotencyKey)` records a
  `DedupEntry` in a module-level `Map` and schedules its own removal after
  the window. The removal only fires if the entry is still the one it
  registered (matched by `correlationId`), so a newer registration for the
  same key is not deleted early.
- `getCorrelationId()` issues `corr-<counter>-<timestamp>` ids. The same id
  ties the pending, success, and error toasts of one action together (see
  `TOAST_CONTRACT` in `useToast.tsx`).
- `clearDedup` and `_clearAllForTests` exist for explicit reset and tests.

The window is intentionally short. It targets accidental repeat clicks, not
retries: a user who deliberately repeats the same action a few seconds later
is not blocked. The source comment describes the window as "shorter than the
idempotency lock TTL (30s) for UX".

### 2. One idempotency key per logical action, reused on every send

- `generateIdempotencyKey()` returns `crypto.randomUUID()` and falls back to
  `idem-<timestamp>-<random>` where `crypto` is unavailable (older
  environments, jest).
- A key is created **once, when the intent is created**, not when the
  request is sent. `Step3Review.tsx` generates the key and correlation id,
  registers them with `registerAction`, and passes the same pair to either
  `api.trades.create` (online) or `enqueue` (offline).
- `offlineQueueStore.enqueue` uses the supplied `idempotencyKey` and
  `correlationId`, and only generates new ones when the caller supplies none.
  The queue (`amana-offline-queue` in `localStorage`, `queue` only via
  `partialize`) therefore stores the key with the action and it survives a
  page refresh.
- On reconnect, `ConnectivityBanner` calls `replay`, and the executor sends
  each action with `Idempotency-Key: <action.idempotencyKey>` and
  `X-Correlation-Id: <action.correlationId>`. `replay` processes actions in
  order, increments `attempts` before each send, dequeues on success, and
  leaves failures in the queue for the next reconnect. Reusing the key is
  what lets the backend return the original result instead of creating a
  duplicate when the first attempt actually succeeded.
- `getOrCreateIdempotencyKey(scope)` / `clearIdempotencyKey(scope)` provide
  the same reuse guarantee for flows that need a key stable per scope within
  a browser session (`sessionStorage`).

## Consequences

- **Positive:** Double-clicks produce a single request and a single toast
  stack, without needing per-button disabled state everywhere.
- **Positive:** Because the key is fixed at intent time, a queued action, a
  refresh, and a replay all present the same key, so the backend's ADR-004
  cache/lock handles the "did the first attempt land?" ambiguity.
- **Positive:** No new dependency, and both mechanisms are a few dozen lines
  that are easy to unit test (`_clearAllForTests` resets the map and counter).
- **Negative:** The de-dup map is per tab and in memory. It is lost on
  reload and is not shared between tabs, so it cannot stop duplicates
  across tabs. Only the server-side idempotency key does that.
- **Negative:** The 3 s window is a UX heuristic, not a correctness
  guarantee. Correctness rests on the idempotency key and the backend.
- **Negative:** The window is keyed by caller-built strings, so two call
  sites that describe the same intent with different key formats are not
  de-duplicated against each other.
- **Negative:** The `replay` catch block notes that a `409` for an
  already-processed key should be treated as success, but the executor
  simply rethrows, so such an action currently stays in the queue and is
  retried on the next reconnect. Treating that case as success is a
  possible follow-up and is not part of this decision.
- **Negative:** `QueuedAction.body` is JSON-serialized into `localStorage`,
  which caps payload size and cannot hold binary data (see
  [ADR-010](./ADR-010-offline-manifest-and-evidence-sync.md)).

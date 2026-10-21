# Offline Cache — Conflict Matrix & Design

> Companion to `src/lib/offlineCache.ts` and the `useCached*` hooks.

---

## 1. Architecture overview

```
┌─────────────────────────────────────────────────────┐
│  useCachedTrades / useCachedTradeDetail              │
│  useCachedNotifications                              │
│         │                                            │
│    ┌────▼────────────────┐   online   ┌──────────┐  │
│    │  offlineCache.ts    │ ◄────────► │  API     │  │
│    │  (localStorage)     │            │  Server  │  │
│    └────────────────────-┘            └──────────┘  │
│         │ stale-while-revalidate                     │
│    ┌────▼────────────────┐                           │
│    │   React UI          │ shows StalenessIndicator  │
│    └────────────────────-┘ when isStale || isOffline │
└─────────────────────────────────────────────────────┘
```

**Read path (stale-while-revalidate)**

1. Read cache synchronously → serve to UI (instant paint, possibly stale).
2. If online: fetch fresh from server in background → overwrite cache → re-render.
3. If offline: serve cached data; show staleness badge; no network call attempted.

**Write path**

All mutations (create trade, deposit, confirm, dispute) go through `api.trades.*`
directly. When online they succeed immediately and the caller calls
`invalidateAndRefetch()` to drop the stale entry and pull fresh data.

When offline, mutations are queued by the offline write queue
(`src/stores/offlineQueueStore.ts`, replayed from `ConnectivityBanner`; see
`offline-resilience.md`). The queue does not touch this cache: replay does not
write server responses into it, and it does not call `cacheInvalidate`. A cached
entry is refreshed by the next `useCached*` revalidation or
`invalidateAndRefetch()`.

---

## 2. TTLs

| Domain          | TTL    | Rationale                                          |
|-----------------|--------|----------------------------------------------------|
| `trades_list`   | 5 min  | List changes infrequently; polling at 5 min is safe |
| `trade_detail`  | 10 min | Detail rarely changes mid-session; 10 min is safe  |
| `notifications` | 2 min  | Most time-sensitive; shorter TTL reduces missed alerts |

TTL values are exported as `TTL_MS` from `offlineCache.ts` for tests.

Expired entries are still served (stale-while-revalidate) but the
`StalenessIndicator` component is shown to inform the user.

---

## 3. Storage quota

Total cache size is capped at **2 MB** (`QUOTA_BYTES`).  When a write would
exceed the quota, the least-recently-written entry (LRU by `cachedAt`) is
evicted until enough space is available.  Up to 100 eviction cycles are
attempted; if still full the write is silently dropped (best-effort cache).

---

## 4. Conflict matrix

The rule is: **server always wins on content; last write wins for timing**.

| Scenario | Resolution | Behaviour |
|---|---|---|
| Online write succeeds (2xx) | **Server wins** | Cache invalidated; fresh fetch triggered by `invalidateAndRefetch()` |
| Offline queue replayed; server returns 2xx | **Server wins** | Action removed from the queue. The cache is not written by replay; the entry is refreshed by the next revalidation / `invalidateAndRefetch()` |
| Offline queue replayed; server returns 409 Conflict | **Server wins** | Not special-cased: the action stays queued, the "Partial sync" toast is shown, and the cache entry is left as-is until the next revalidation |
| Server data `updatedAt` > local `cachedAt` | **Server wins** | Overwrites local entry; `isStale` cleared |
| Local `cachedAt` appears newer (clock skew ≤ 30s) | **Server wins** | Server response still overwrites; clock skew is logged but not acted upon |
| Corruption in localStorage (JSON parse error) | **Neither** | Affected key removed; treat as cache miss; fresh fetch attempted |
| Storage quota full during write | **Drop write** | Existing valid data retained; new write silently dropped; no error surfaced |

**Rationale:** The Amana escrow model means funds can only move via signed
on-chain transactions; local state never triggers payments.  Server data is
therefore always the authoritative source of truth.  Optimistic local state
that conflicts with a server 409 is discarded without a merge step.

---

## 5. Domain isolation

Each domain (`trades_list`, `trade_detail`, `notifications`) has its own
namespace under `amana_cache_v1:<domain>:<key>`.  Clearing or corrupting one
domain does not affect others.

---

## 6. Survival across restarts

Data is backed by `localStorage`, which persists across page reloads and
browser restarts.  Cache entries older than their TTL are served stale but
immediately revalidated on next online session.

---

## 7. Eviction policy summary

1. **On write**: if `getCacheUsageBytes() + newEntryBytes > QUOTA_BYTES`, evict LRU.
2. **On read**: corrupt entries are evicted inline (treat as miss).
3. **On demand**: `cacheInvalidate(domain, key)` removes one entry.
4. **Domain clear**: `cacheClearDomain(domain)` removes all entries in a domain.
5. **Full clear**: `cacheClearAll()` removes the entire `amana_cache_v1` namespace.

---

## 8. Testing approach

- Unit tests for `offlineCache.ts` cover: write/read round-trip, TTL expiry,
  stale serving, LRU eviction, quota enforcement, and corruption recovery.
- Hook tests for `useCachedTrades` and `useCachedTradeDetail` cover:
  cache-seed on mount, background revalidation, offline bypass, and
  invalidation flow.
- See `src/lib/__tests__/offlineCache.test.ts` and
  `src/hooks/__tests__/useCachedTrades.test.ts`.

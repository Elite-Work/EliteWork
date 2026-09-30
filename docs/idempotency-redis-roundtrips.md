# Idempotency Middleware — Redis Round Trips

> Status: Active | Owner: Platform | Issue: #104

`backend/src/middleware/idempotency.ts` guards every mutating request that carries an
`Idempotency-Key` header. Each Redis command is a network round trip, so the number of
commands per request directly adds latency on the hot path (e.g. `POST /trades`).

## Before / after

| Request path | Before | After |
|---|---|---|
| First request, 2xx response | **5** — `GET` cache, `SET NX` lock, `SET` cache ×2, `DEL` lock | **2** — `EVAL acquire`, `EVAL commit` |
| First request, non-2xx response | **3** — `GET`, `SET NX`, `DEL` | **2** — `EVAL acquire`, `DEL` |
| Cached replay | **1** — `GET` | **1** — `EVAL acquire` |
| Concurrent duplicate (in flight) | 2 + one `GET` per 25 ms poll | 1 + one `GET` per 25 ms poll |

For the common path (a fresh successful mutation) this is a **60% reduction** in Redis
round trips. At a typical 0.5–1 ms intra-VPC RTT that removes ~1.5–3 ms per request, and
it takes 3 commands per request off Redis under load.

## How

- **`IDEMPOTENCY_ACQUIRE_SCRIPT`** — `GET` the cached response; if absent, `SET NX EX` the
  lock. Returns the cached payload, `1` (lock acquired) or `0` (another request holds it).
  Doing both atomically also closes the gap between the cache check and the lock.
- **`IDEMPOTENCY_COMMIT_SCRIPT`** — `SET` the cached response with its 24 h TTL and `DEL`
  the lock in one call. The `finish`/`close` handler then skips its own `DEL`.
- **Duplicate cache write fix** — Express' `res.json()` calls `res.send()` with the
  serialized string, so both overrides fired and the response was written twice, the second
  time with a string body (which replayed as double-encoded JSON). Only the first call is
  cached now.

Failure behaviour is unchanged: if Redis errors, the middleware fails open (see
[redis-resilience.md](./redis-resilience.md)). If the commit script fails, the lock is
released with a fallback `DEL`.

## Regression check (CI)

`backend/src/__tests__/idempotency.middleware.test.ts` → `Redis round-trip budget` asserts
the exact command sequence for each path above, so any change that adds a round trip fails
the backend test job:

```bash
cd backend && npx jest src/__tests__/idempotency.middleware.test.ts
```

## Cluster note

Both scripts touch the cache key and the lock key. The backend uses a single Redis node
today; moving to Redis Cluster would require a shared hash tag on the two keys
(e.g. `idempotency:{POST:/trades:<key>}`).

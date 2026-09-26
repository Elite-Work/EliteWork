# Database Connection-Pool Exhaustion — Trade Creation Behavior

Issue #122. This document records the **confirmed, tested behavior** of the
backend when Prisma's connection pool is exhausted during a burst of concurrent
trade-creation requests, so the contract is explicit rather than inferred from
reading the code.

Implementation: [`src/lib/dbPoolErrors.ts`](../src/lib/dbPoolErrors.ts)
Regression tests: [`src/__tests__/db.pool.exhaustion.test.ts`](../src/__tests__/db.pool.exhaustion.test.ts)

---

## 1. What actually happens

Prisma fronts PostgreSQL with a fixed-size connection pool (`connection_limit`,
default `num_cpus * 2 + 1`). Each `prisma.trade.create(...)` call checks out a
connection for the duration of the query.

Under a burst larger than the pool, the behavior has two distinct phases:

| Phase | Behavior |
|-------|----------|
| **Queueing (bounded)** | Excess queries wait in Prisma's pool queue until a connection is released. This is **not** unbounded: it is capped by `pool_timeout` (10s by default), configured on `DATABASE_URL`. |
| **Fail fast with a clear error** | If no connection frees up within `pool_timeout`, Prisma rejects the query with `P2024` — *"Timed out fetching a new connection from the connection pool"*. |

So the answer to the issue's question is: **the app queues only for the
`pool_timeout` window, then fails fast with a clear, retryable error.** It does
not queue indefinitely waiting for a connection.

## 2. API contract on `P2024`

`TradeService.createPendingTrade` classifies the Prisma error with
`isPrismaPoolExhaustionError()` and re-throws
`toPoolExhaustionAppError("create_pending_trade")`, which the shared error
handler renders as:

```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/json

{
  "code": "INFRA_ERROR",
  "message": "Database connection pool exhausted while handling create_pending_trade. The request was not completed; retry after a short backoff.",
  "details": {
    "reason": "DB_POOL_EXHAUSTED",
    "retryable": true,
    "operation": "create_pending_trade"
  },
  "timestamp": "…",
  "path": "/trades",
  "requestId": "…",
  "correlationId": "…"
}
```

- **503, not 500** — the dependency is briefly unavailable; the caller can retry.
- **`details.retryable: true`** — machine-readable retry hint, no message parsing.
- **No silent queue-ahead** — `trade.create` is invoked exactly once per request;
  the app layer adds no retry loop of its own.

## 3. Why trade creation is never auto-retried

Trade creation is a **non-idempotent INSERT**. Blindly retrying it would create
duplicate `Trade` rows, so it is deliberately excluded from `retryAsync`
(`src/lib/retry.ts` classifies `P2024` as retryable, but the trade-creation path
passes `maxRetries: 0` semantics by not wrapping the insert at all).

Clients that want safe retry semantics should resend with the same
`Idempotency-Key`: the route is wrapped in `idempotencyMiddleware`, so a replay
of the same key returns the cached response instead of inserting a second trade.

## 4. Operator signals

A sustained pool-exhaustion condition is observable rather than silent:

- `alertRegistry.ts` defines the `db_connection_pool_exhausted` / database
  unreachable alert; a burst that trips `P2024` should be investigated there.
- Each surfaced error is logged with `operation` and `tradeId` so a spike can be
  traced back to the affected requests.

## 5. Recovery

Exhaustion is **transient by construction**: once in-flight queries complete and
connections return to the pool, the next `createPendingTrade` call succeeds
without a restart. The regression suite asserts this recovery explicitly
("recovers once the pool frees up") so a future change cannot silently wedge the
trade-creation path.

## 6. Tuning knobs

| Setting | Where | Effect |
|---------|-------|--------|
| `connection_limit` | `DATABASE_URL` | Max connections per instance; raise to absorb larger bursts. |
| `pool_timeout` | `DATABASE_URL` | How long a query waits for a connection before `P2024` (default 10s). |
| `pgbouncer=true` + `pool_mode` | `DATABASE_URL` | Route through PgBouncer to amortize connections across instances. |

See `prisma/schema.prisma` for the connection-pooling guidance comment and
`docs/retry-classification.md` for how `P2024` is classified in the general
retry wrapper.

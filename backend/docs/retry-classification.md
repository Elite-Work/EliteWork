# Retry Classification Rules — EliteWork Backend

Issue #220 introduces a shared retry wrapper (`src/lib/retry.ts`) with
exponential backoff + full jitter, explicit error classification, and
OpenTelemetry metrics. This document describes the classification rules
and usage guidelines.

---

## Overview

```
retryAsync(operation, options)
```

- **Full jitter**: `delay = rand(0, min(cap, base × 2^attempt))`
  Distributes retry load uniformly, preventing thundering-herd storms.
- **Budget cap**: total elapsed time across all attempts is bounded by `budgetMs`.
- **Idempotency safety**: non-idempotent writes must set `maxRetries: 0`.
- **Metrics**: every attempt and outcome is exported via OpenTelemetry.

---

## Error Classification Decision Table

Errors are evaluated in priority order. The first matching rule wins.

| Priority | Condition                                      | Retryable? | Rationale                                          |
|----------|------------------------------------------------|------------|-----------------------------------------------------|
| 1        | HTTP 4xx (except 429)                          | ❌ No      | Client error — retrying won't fix the request       |
| 2        | HTTP 429 (Too Many Requests)                   | ✅ Yes     | Rate limit — back off and retry                     |
| 3        | HTTP 500, 502, 503, 504                        | ✅ Yes     | Server-side transient failure                       |
| 4        | Prisma P1001 (cannot reach DB server)          | ✅ Yes     | Network/infra hiccup                                |
| 5        | Prisma P1002 (DB server closed connection)     | ✅ Yes     | Network/infra hiccup                                |
| 6        | Prisma P1017 (server closed connection)        | ✅ Yes     | Network/infra hiccup                                |
| 7        | Prisma P2024 (connection pool timeout)         | ✅ Yes     | Pool saturation — backoff helps                     |
| 8        | Prisma P2028 (transaction API error/rollback)  | ✅ Yes     | Rollback — safe to retry if idempotent              |
| 9        | Prisma P2002 (unique constraint)               | ❌ No      | Data conflict — retrying will repeat the error      |
| 10       | Prisma P2003 (foreign key constraint)          | ❌ No      | Schema violation — not transient                    |
| 11       | Supabase PGRST301 (upstream unavailable)       | ✅ Yes     | PostgREST upstream failure                          |
| 12       | Supabase 57P01/02/03 (Postgres shutdown)       | ✅ Yes     | Postgres maintenance / failover                     |
| 13       | Supabase 08006, 08001 (connection failure)     | ✅ Yes     | Network-level DB connection failure                 |
| 14       | Supabase 40001 (serialization failure)         | ✅ Yes     | Safe to retry per SQL standard                      |
| 15       | Supabase 40P01 (deadlock detected)             | ✅ Yes     | Safe to retry per SQL standard                      |
| 16       | Supabase PGRST116 (row not found)              | ❌ No      | Not a transient error — row genuinely missing       |
| 17       | Supabase 23505 (unique violation)              | ❌ No      | Data conflict                                       |
| 18       | ECONNREFUSED, ECONNRESET, ETIMEDOUT            | ✅ Yes     | Network-level transient failure                     |
| 19       | "socket hang up", "fetch failed"               | ✅ Yes     | Network-level transient failure                     |
| 20       | Anything else                                  | ❌ No      | Unknown — do not retry blindly                      |

---

## Idempotency Safety

**Non-idempotent writes (INSERT, UPDATE, DELETE) must NEVER be auto-retried
without an explicit idempotency mechanism.**

A blind retry on an INSERT could create duplicate rows. Use `maxRetries: 0` for
non-idempotent writes:

```typescript
// ✅ Correct — non-idempotent write, no retry
const { data, error } = await retryAsync(
  () => supabase.from("trades").insert(payload).select().single(),
  { operationName: "create_trade", maxRetries: 0 },
);

// ✅ Correct — idempotent read, retry on transient failures
const { data, error } = await retryAsync(
  () => supabase.from("users").select("*").eq("id", userId).single(),
  { operationName: "fetch_user" },
);

// ✅ Correct — idempotent UPDATE with WHERE clause, retry if needed
// Only safe because the outcome of retrying is identical (no duplicates).
// Must verify the specific update is truly idempotent before enabling retries.
const { data, error } = await retryAsync(
  () => supabase.from("users").update({ name }).eq("id", userId).select().single(),
  { operationName: "update_user_name", maxRetries: 0 }, // still 0 to be safe
);
```

---

## Options Reference

| Option          | Default    | Description                                              |
|-----------------|------------|----------------------------------------------------------|
| `maxRetries`    | `3`        | Maximum retry attempts after the initial try             |
| `baseDelayMs`   | `200`      | Base delay for exponential backoff formula               |
| `capMs`         | `10_000`   | Upper cap for any single delay window                    |
| `budgetMs`      | `30_000`   | Total elapsed time budget across all attempts            |
| `shouldRetry`   | `classifyError` | Custom override for retryability decision            |
| `onRetry`       | `undefined`| Callback called before each retry sleep                  |
| `operationName` | `"unknown"`| Label used in metrics                                    |
| `sleep`         | `setTimeout`| Injected sleep (override in tests)                      |

---

## Metrics

All retried operations emit OpenTelemetry metrics under the `amana-retry` meter:

| Metric name                | Type      | Labels                        | Description                              |
|---------------------------|-----------|-------------------------------|------------------------------------------|
| `retry_attempts_total`     | Counter   | `operation`, `attempt`        | Each individual retry attempt            |
| `retry_outcomes_total`     | Counter   | `operation`, `outcome`        | Final outcome of the operation           |
| `retry_total_duration_ms`  | Histogram | `operation`, `outcome`        | Total elapsed time including all retries |

**Outcome values:**
- `success` — operation succeeded (possibly after retries)
- `exhausted` — max retries reached, last error thrown
- `non_retryable` — error classification said no retry, thrown immediately
- `budget_exceeded` — time budget would be exceeded, thrown early

---

## Applied Call Sites

| Service               | Operation                  | `maxRetries` | Rationale                              |
|-----------------------|---------------------------|--------------|----------------------------------------|
| `user.service.ts`     | `find_user_by_address`     | 3 (default)  | Idempotent SELECT                      |
| `user.service.ts`     | `create_user`              | 0            | Non-idempotent INSERT                  |
| `user.service.ts`     | `find_user_after_conflict` | 3 (default)  | Idempotent SELECT (post-conflict)      |
| `user.service.ts`     | `update_user_profile`      | 0            | Non-idempotent UPDATE                  |
| `user.service.ts`     | `get_public_profile`       | 3 (default)  | Idempotent SELECT                      |

---

## Brownout Validation

The retry wrapper was tested with the following injected-failure scenarios:

| Injected failure                | Attempts to recover | Pod behaviour                     |
|---------------------------------|---------------------|-----------------------------------|
| 2× ECONNREFUSED                 | 3                   | Recovers on 3rd attempt           |
| Supabase 40001 (serialization)  | 2                   | Recovers on 2nd attempt           |
| HTTP 429 (rate limit)           | 3                   | Recovers on 3rd attempt           |
| Supabase 57P01 (admin shutdown) | 2                   | Recovers on 2nd attempt           |
| HTTP 404 (not found)            | 1                   | Throws immediately — no retry     |
| Sustained P1001 (4 attempts)    | 4                   | Exhausted — throws last error     |

See `src/__tests__/retry.test.ts` for the full chaos test suite.

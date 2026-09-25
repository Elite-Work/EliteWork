/**
 * Connection-pool exhaustion classification (Issue #122).
 *
 * Prisma's connection pool queues a query until a connection frees up, bounded
 * by the `pool_timeout` connection-string parameter (10s by default). When that
 * window elapses Prisma stops waiting and rejects with error code `P2024`
 * ("Timed out fetching a new connection from the connection pool").
 *
 * That failure is infrastructure-shaped, not request-shaped, so it must be
 * surfaced to the caller as a *retryable* 503 rather than the generic 500 the
 * trade-creation path used to return. Classification is structural (error
 * `code` first, then message) because Prisma errors can cross module/bundle
 * boundaries where `instanceof PrismaClientKnownRequestError` is unreliable.
 *
 * See `docs/connection-pool-exhaustion.md` for the full expected-behavior
 * contract and `src/__tests__/db.pool.exhaustion.test.ts` for the burst-load
 * regression tests.
 */

import { AppError, ErrorCode } from "../errors/errorCodes";

/** Prisma code emitted when a connection cannot be checked out in time. */
export const PRISMA_POOL_EXHAUSTION_CODE = "P2024";

/** Stable machine-readable reason attached to the surfaced AppError. */
export const DB_POOL_EXHAUSTED_REASON = "DB_POOL_EXHAUSTED";

const POOL_TIMEOUT_MESSAGE = /timed out fetching a new connection from the connection pool/i;

/**
 * Detect a Prisma connection-pool exhaustion error.
 *
 * Matches on the documented `P2024` code or the pool-timeout message so the
 * check keeps working if the error is re-wrapped while crossing an async or
 * module boundary.
 */
export function isPrismaPoolExhaustionError(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }

  const { code, message } = error as { code?: unknown; message?: unknown };

  if (code === PRISMA_POOL_EXHAUSTION_CODE) {
    return true;
  }

  return typeof message === "string" && POOL_TIMEOUT_MESSAGE.test(message);
}

/**
 * Build the clear, retryable error returned to API callers when the pool is
 * saturated. HTTP 503 (rather than 500) signals "the dependency is briefly
 * unavailable — retry", and `details.retryable` lets clients distinguish this
 * from a permanent failure without parsing the message.
 */
export function toPoolExhaustionAppError(operation: string): AppError {
  return new AppError(
    ErrorCode.INFRA_ERROR,
    `Database connection pool exhausted while handling ${operation}. The request was not completed; retry after a short backoff.`,
    503,
    {
      reason: DB_POOL_EXHAUSTED_REASON,
      retryable: true,
      operation,
    },
  );
}

/**
 * Shared retry wrapper with exponential backoff + full jitter.
 *
 * Issue #220: replaces ad-hoc per-call-site retries with a single,
 * well-classified, metrics-emitting wrapper.
 *
 * Design:
 *   - Full jitter: delay = rand(0, min(cap, base * 2^attempt))
 *     Reference: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 *   - Explicit error classification: Supabase, Prisma, and HTTP errors
 *     are categorised as retryable or non-retryable before the first retry.
 *   - Idempotency safety: non-idempotent writes (INSERT/UPDATE/DELETE
 *     without an explicit idempotency key) are never auto-retried.
 *   - Budget cap: total elapsed time is bounded by `budgetMs`.
 *   - Metrics: retry attempts and outcomes are exported via OpenTelemetry.
 */

import { Counter, Histogram, metrics } from "@opentelemetry/api";
import { appLogger } from "../middleware/logger";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 3;
/** Base delay in ms for the exponential formula. */
const DEFAULT_BASE_DELAY_MS = 200;
/** Upper cap for any single delay window before jitter is applied. */
const DEFAULT_CAP_MS = 10_000;
/** Maximum total budget for all attempts including delays. */
const DEFAULT_BUDGET_MS = 30_000;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type SleepFn = (ms: number) => Promise<void>;

export type RetryOutcome = "success" | "exhausted" | "non_retryable" | "budget_exceeded";

export interface RetryOptions {
  /** Maximum number of retry attempts (not counting the first try). */
  maxRetries?: number;
  /** Base delay in ms for the exponential backoff calculation. */
  baseDelayMs?: number;
  /** Upper cap for a single delay window in ms. */
  capMs?: number;
  /** Maximum total elapsed time budget across all attempts in ms. */
  budgetMs?: number;
  /**
   * Override the retryability decision.
   * Return `true` to retry, `false` to throw immediately.
   * If omitted, `classifyError` is used.
   */
  shouldRetry?: (error: unknown) => boolean;
  /** Called before each retry sleep. Useful for logging or test spying. */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /**
   * Logical operation name used as a metric label.
   * Defaults to "unknown".
   */
  operationName?: string;
  /**
   * Injected sleep implementation. Defaults to `setTimeout`-based sleep.
   * Override in tests to avoid real timers.
   */
  sleep?: SleepFn;
  /**
   * @deprecated Use `baseDelayMs` + `capMs` instead.
   * Fixed backoff array for backwards compatibility with the original
   * retry.ts interface. When provided, overrides the exponential jitter
   * calculation and uses `backoffMs[attempt]` directly (clamped to last
   * element if attempt exceeds array length).
   */
  backoffMs?: number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prisma error codes that indicate a transient infrastructure failure
 * and are safe to retry on idempotent operations.
 *
 * P1001 — Cannot reach database server
 * P1002 — Database server closed the connection
 * P1017 — Server closed the connection
 * P2024 — Connection pool timeout
 * P2028 — Transaction API error (rollback)
 */
const RETRYABLE_PRISMA_CODES = new Set([
  "P1001",
  "P1002",
  "P1017",
  "P2024",
  "P2028",
]);

/**
 * Supabase/PostgREST error codes that indicate a transient failure.
 * These appear as `error.code` on Supabase client errors.
 *
 * PGRST301 — upstream resource unavailable
 * 57P01    — admin_shutdown (Postgres signal)
 * 57P02    — crash_shutdown
 * 57P03    — cannot_connect_now (standby in recovery)
 * 08006    — connection failure
 * 08001    — unable to establish connection
 * 40001    — serialization_failure (safe to retry)
 * 40P01    — deadlock_detected (safe to retry)
 */
const RETRYABLE_SUPABASE_CODES = new Set([
  "PGRST301",
  "57P01",
  "57P02",
  "57P03",
  "08006",
  "08001",
  "40001",
  "40P01",
]);

/**
 * HTTP status codes that indicate a retriable condition.
 *   429 — Too Many Requests (rate limited; back off)
 *   500 — Internal Server Error
 *   502 — Bad Gateway
 *   503 — Service Unavailable
 *   504 — Gateway Timeout
 */
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Non-retryable HTTP status codes.
 * Client errors (4xx except 429) indicate a request problem that retrying
 * will not fix, and should propagate immediately.
 */
function isClientError(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429;
}

/**
 * Loose shape for the error-like objects thrown by Prisma, Supabase/PostgREST,
 * and HTTP clients. Fields are `unknown` because callers only ever narrow them
 * with `typeof`/`Number()` checks below.
 */
interface ErrorLike {
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  details?: unknown;
  error?: unknown;
  response?: {
    status?: unknown;
    statusCode?: unknown;
  };
}

function extractHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;

  const err = error as ErrorLike;
  const candidates = [
    err.status,
    err.statusCode,
    err.response?.status,
    err.response?.statusCode,
  ];

  for (const c of candidates) {
    const n = Number(c);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return undefined;
}

function extractPrismaCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  // Prisma errors carry a `code` string like "P1001"
  const code = (error as ErrorLike).code;
  return typeof code === "string" ? code : undefined;
}

function extractSupabaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  // Supabase client errors expose error.code (PostgreSQL SQLSTATE or PGRST code)
  const err = error as ErrorLike;
  const code = err.code;
  if (typeof code === "string" && code.length > 0) return code;

  // Also check nested error details for PostgREST responses
  const details = err.details ?? err.error;
  if (details && typeof details === "object") {
    const nested = (details as ErrorLike).code;
    if (typeof nested === "string") return nested;
  }
  return undefined;
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("network") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed")
  );
}

/**
 * Classify whether an error is safe to retry.
 *
 * Classification rules (in priority order):
 * 1. Client HTTP errors (4xx except 429) → NOT retryable
 * 2. Retryable HTTP statuses (429, 500-504) → retryable
 * 3. Prisma connection/pool error codes → retryable
 * 4. Supabase transient error codes → retryable
 * 5. Network-level errors (ECONNREFUSED, ETIMEDOUT, etc.) → retryable
 * 6. Anything else → NOT retryable
 *
 * See docs/retry-classification.md for the full decision table.
 */
export function classifyError(error: unknown): boolean {
  const httpStatus = extractHttpStatus(error);

  if (httpStatus !== undefined) {
    if (isClientError(httpStatus)) return false;
    return RETRYABLE_HTTP_STATUSES.has(httpStatus);
  }

  const prismaCode = extractPrismaCode(error);
  if (prismaCode && RETRYABLE_PRISMA_CODES.has(prismaCode)) return true;

  const supabaseCode = extractSupabaseCode(error);
  if (supabaseCode && RETRYABLE_SUPABASE_CODES.has(supabaseCode)) return true;

  if (isNetworkError(error)) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Jitter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a full-jitter delay for a given attempt (0-indexed retry count).
 *
 * Formula: rand(0, min(cap, base * 2^attempt))
 *
 * "Full jitter" means the delay is uniformly distributed between 0 and the
 * exponential window. This produces a better aggregate load profile under
 * thundering-herd conditions than clamped or equal jitter.
 */
export function computeJitteredDelay(
  attempt: number,
  baseDelayMs: number,
  capMs: number,
  randFn: () => number = Math.random,
): number {
  const window = Math.min(capMs, baseDelayMs * Math.pow(2, attempt));
  return Math.floor(randFn() * window);
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics
// ─────────────────────────────────────────────────────────────────────────────

const METER_NAME = "amana-retry";

let retryAttemptsCounter: Counter | undefined;
let retryDurationHistogram: Histogram | undefined;
let retryOutcomeCounter: Counter | undefined;
let customRetryRecorder: RetryMetricsRecorder | null = null;

export interface RetryMetricsRecorder {
  recordAttempt(operationName: string, attempt: number): void;
  recordOutcome(operationName: string, outcome: RetryOutcome, totalAttempts: number, durationMs: number): void;
}

function getMeter() {
  return metrics.getMeter(METER_NAME);
}

function getRetryAttemptsCounter(): Counter {
  if (!retryAttemptsCounter) {
    retryAttemptsCounter = getMeter().createCounter("retry_attempts_total", {
      description: "Total retry attempts (excluding the initial try)",
    });
  }
  return retryAttemptsCounter;
}

function getRetryDurationHistogram(): Histogram {
  if (!retryDurationHistogram) {
    retryDurationHistogram = getMeter().createHistogram("retry_total_duration_ms", {
      description: "Total elapsed time for an operation including all retries",
      unit: "ms",
    });
  }
  return retryDurationHistogram;
}

function getRetryOutcomeCounter(): Counter {
  if (!retryOutcomeCounter) {
    retryOutcomeCounter = getMeter().createCounter("retry_outcomes_total", {
      description: "Outcomes of retried operations: success, exhausted, non_retryable, budget_exceeded",
    });
  }
  return retryOutcomeCounter;
}

function recordAttempt(operationName: string, attempt: number): void {
  if (customRetryRecorder) {
    customRetryRecorder.recordAttempt(operationName, attempt);
    return;
  }
  getRetryAttemptsCounter().add(1, { operation: operationName, attempt: String(attempt) });
}

function recordOutcome(
  operationName: string,
  outcome: RetryOutcome,
  totalAttempts: number,
  durationMs: number,
): void {
  if (customRetryRecorder) {
    customRetryRecorder.recordOutcome(operationName, outcome, totalAttempts, durationMs);
    return;
  }
  getRetryOutcomeCounter().add(1, { operation: operationName, outcome });
  getRetryDurationHistogram().record(durationMs, { operation: operationName, outcome });
}

// ─────────────────────────────────────────────────────────────────────────────
// Core retry wrapper
// ─────────────────────────────────────────────────────────────────────────────

let sleepImpl: SleepFn = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Execute `operation` with exponential backoff + full jitter retry logic.
 *
 * @param operation  Async function to run. Must be idempotent if retryable.
 * @param options    Retry configuration (see RetryOptions).
 * @returns          The resolved value of `operation` on success.
 * @throws           The last error if all retries are exhausted, or the first
 *                   non-retryable error encountered.
 *
 * @example
 * // Idempotent read — safe to retry
 * const user = await retryAsync(
 *   () => supabase.from("users").select("*").eq("id", userId).single(),
 *   { operationName: "fetch_user" }
 * );
 *
 * @example
 * // Non-idempotent write — use idempotency key or disable retries
 * const result = await retryAsync(
 *   () => supabase.from("trades").insert({ ...payload }),
 *   { maxRetries: 0 }  // or pass idempotencyKey via app logic
 * );
 */
export async function retryAsync<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const capMs = options.capMs ?? DEFAULT_CAP_MS;
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const shouldRetry = options.shouldRetry ?? classifyError;
  const sleep = options.sleep ?? sleepImpl;
  const operationName = options.operationName ?? "unknown";

  const startTime = Date.now();
  let attempt = 0; // number of retries so far (first try = 0 retries)

  while (true) {
    try {
      const result = await operation();
      const durationMs = Date.now() - startTime;
      recordOutcome(operationName, "success", attempt + 1, durationMs);
      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // Check if the error is retryable at all
      if (!shouldRetry(error)) {
        recordOutcome(operationName, "non_retryable", attempt + 1, durationMs);
        throw error;
      }

      // Check retry budget
      if (attempt >= maxRetries) {
        appLogger.warn(
          { operationName, attempt, durationMs },
          "Retry budget exhausted",
        );
        recordOutcome(operationName, "exhausted", attempt + 1, durationMs);
        throw error;
      }

      // Compute delay: use legacy backoffMs array if provided, else exponential jitter
      const delayMs = options.backoffMs
        ? (options.backoffMs[Math.min(attempt, options.backoffMs.length - 1)] ?? 0)
        : computeJitteredDelay(attempt, baseDelayMs, capMs);

      // Check time budget
      if (durationMs + delayMs > budgetMs) {
        appLogger.warn(
          { operationName, attempt, durationMs, delayMs, budgetMs },
          "Retry time budget would be exceeded",
        );
        recordOutcome(operationName, "budget_exceeded", attempt + 1, durationMs);
        throw error;
      }

      attempt += 1;
      recordAttempt(operationName, attempt);

      options.onRetry?.(error, attempt, delayMs);

      appLogger.debug(
        {
          operationName,
          attempt,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        },
        "Retrying operation after transient error",
      );

      await sleep(delayMs);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Backwards-compatible helpers (preserved from original retry.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use `classifyError` instead. Kept for backwards compatibility.
 * Returns true if the error has a retryable HTTP status code.
 */
export function isRetryableNetworkError(error: unknown): boolean {
  const httpStatus = extractHttpStatus(error);
  if (httpStatus === undefined) return false;
  if (httpStatus === 429) return true;
  return httpStatus >= 500 && httpStatus < 600;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Override the sleep implementation for tests (avoids real timers). */
export function __setRetrySleepForTests(sleep: SleepFn): void {
  sleepImpl = sleep;
}

/** Reset the sleep implementation to production default. */
export function __resetRetrySleepForTests(): void {
  sleepImpl = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
}

/** Inject a mock metrics recorder for test assertions. */
export function __setRetryMetricsRecorderForTests(
  recorder: RetryMetricsRecorder | null,
): void {
  customRetryRecorder = recorder;
}

/** Reset metrics recorder and singleton counters. */
export function __resetRetryMetricsForTests(): void {
  customRetryRecorder = null;
  retryAttemptsCounter = undefined;
  retryDurationHistogram = undefined;
  retryOutcomeCounter = undefined;
}

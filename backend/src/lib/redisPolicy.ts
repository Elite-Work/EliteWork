/**
 * Redis Resilience Policy — per-consumer behavior during Redis unavailability.
 *
 * This module documents and enforces the expected behavior for every Redis-backed
 * consumer when Redis is unreachable, during failover, or during maintenance.
 *
 * Design principles:
 * - PAYOUT-SAFETY-CRITICAL paths MUST fail-closed (deny action, return 503) when
 *   Redis is unavailable if they rely on Redis for correctness.
 * - NON-CRITICAL paths (cache, rate-limit, queues) MUST degrade gracefully
 *   (serve via fallback, allow request but alert).
 * - No split-brain double payout: DB-backed locks remain source of truth.
 */

import { EventEmitter } from "events";
import { redis } from "./redis";
import { appLogger } from "../middleware/logger";

// ioredis's TS types don't surface EventEmitter/command methods here due to the
// constructor overload workaround in redis.ts (see the @ts-expect-error there).
const redisEvents = redis as unknown as EventEmitter;

export type RedisConsumer =
  | "stream-lock" // DB-backed, not Redis — listed for completeness
  | "clawback-distributed-lock"
  | "idempotency"
  | "cache"
  | "rate-limit"
  | "queue"
  | "auth-challenge"
  | "feature-flags";

export interface ConsumerPolicy {
  consumer: RedisConsumer;
  onRedisDown: "fail-closed" | "fail-open-graceful" | "degrade-queue";
  description: string;
  rationale: string;
}

/**
 * Canonical policy table. Keep in sync with docs/redis-resilience.md
 */
export const REDIS_CONSUMER_POLICY: Record<RedisConsumer, ConsumerPolicy> = {
  "stream-lock": {
    consumer: "stream-lock",
    onRedisDown: "fail-closed",
    description: "Stream lock is DB-backed (stream.lockedAt). Redis down does NOT unlock streams.",
    rationale: "Payout safety must not depend on cache availability. DB is source of truth; requireStreamNotLocked always checks DB.",
  },
  "clawback-distributed-lock": {
    consumer: "clawback-distributed-lock",
    onRedisDown: "fail-closed",
    description: "Clawback uses Redis SET NX EX 30s distributed lock + in-memory fallback. On Redis failure, deny new clawback with 503.",
    rationale: "Prevents split-brain double payout if two pods acquire in-memory lock independently. Fail-closed until Redis recovers.",
  },
  idempotency: {
    consumer: "idempotency",
    onRedisDown: "fail-open-graceful",
    description: "Idempotency middleware proceeds without caching (next()) but alerts cache_unavailable.",
    rationale: "Availability over strict idempotency for non-payout paths. Payout paths additionally require DB uniqueness constraint.",
  },
  cache: {
    consumer: "cache",
    onRedisDown: "fail-open-graceful",
    description: "cacheGet returns null, cacheSet no-ops, callers fall back to DB/Horizon. Warn logs + cache_unavailable alert.",
    rationale: "Cache is optimization, not correctness. Stale-while-revalidate is not required during outage.",
  },
  "rate-limit": {
    consumer: "rate-limit",
    onRedisDown: "fail-open-graceful",
    description: "Rate limiting uses MemoryStore; on Redis down it remains in-memory per-pod (allow request, may be lenient). Documented as FAIL-OPEN with alert.",
    rationale: "Do not block legitimate traffic during Redis outage. Rate-limit bypass is acceptable degradation; DDoS protection degrades gracefully. See docs/redis-resilience.md for allow vs deny choice.",
  },
  queue: {
    consumer: "queue",
    onRedisDown: "degrade-queue",
    description: "BullMQ queues buffer in Redis. On disconnect, producers throw, workers pause, reconnect with exponential backoff; jobs remain durable on recovery.",
    rationale: "Queues are durable via Redis persistence + DLQ. No job loss on reconnect; startup probe blocks traffic until Redis ready.",
  },
  "auth-challenge": {
    consumer: "auth-challenge",
    onRedisDown: "fail-closed",
    description: "Challenge generation/verification and token revocation require Redis. Fail-closed with 503 when unavailable.",
    rationale: "Auth correctness requires revocation list. Fail-closed prevents use of revoked tokens during split-brain.",
  },
  "feature-flags": {
    consumer: "feature-flags",
    onRedisDown: "fail-open-graceful",
    description: "Flags fall back to DB/default when Redis unavailable.",
    rationale: "Non-critical control plane.",
  },
};

let redisAvailable = true;
let lastTransitionAt = Date.now();

export function isRedisAvailable(): boolean {
  return redisAvailable;
}

export function getRedisAvailability() {
  return { available: redisAvailable, lastTransitionAt };
}

// Wire up availability tracking without interfering with existing listeners in redis.ts
if (typeof redisEvents.on === "function") {
  redisEvents.on("ready", () => {
    if (!redisAvailable) {
      appLogger.info("Redis recovered — marking available");
    }
    redisAvailable = true;
    lastTransitionAt = Date.now();
  });
  redisEvents.on("close", () => {
    redisAvailable = false;
    lastTransitionAt = Date.now();
  });
  redisEvents.on("error", () => {
    // do not immediately mark unavailable on transient error; close event is authoritative
  });
  redisEvents.on("end", () => {
    redisAvailable = false;
    lastTransitionAt = Date.now();
  });
}

/**
 * Error thrown by `withRedisFailClosed` when a fail-closed consumer is denied
 * due to Redis unavailability. Carries an HTTP status so `errorHandler`
 * can respond with 503 without special-casing this module.
 */
export class RedisUnavailableError extends Error {
  readonly status = 503;
  readonly code = "REDIS_UNAVAILABLE";
  readonly consumer: RedisConsumer;

  constructor(consumer: RedisConsumer) {
    super(`Service temporarily unavailable: Redis required for ${consumer}`);
    this.name = "RedisUnavailableError";
    this.consumer = consumer;
  }
}

/**
 * Execute fn only if Redis is available, otherwise throw fail-closed error.
 * Use for payout-critical Redis locks.
 */
export async function withRedisFailClosed<T>(consumer: RedisConsumer, fn: () => Promise<T>): Promise<T> {
  const policy = REDIS_CONSUMER_POLICY[consumer];
  if (!policy) throw new Error(`Unknown Redis consumer: ${consumer}`);
  // Probe liveness with a fast ping; if it fails we treat as unavailable
  try {
    await Promise.race([
      redis.ping(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Redis ping timeout")), 1000)),
    ]);
  } catch {
    redisAvailable = false;
    if (policy.onRedisDown === "fail-closed") {
      appLogger.error({ consumer }, "Fail-closed Redis consumer denied due to Redis unavailability");
      throw new RedisUnavailableError(consumer);
    }
    // for graceful consumers, let caller handle fallback
    throw new Error(`Redis unavailable for ${consumer}`);
  }
  return fn();
}

/**
 * Helper to wrap queue operations with reconnection semantics.
 * Queues resume cleanly after reconnect by design (BullMQ retries).
 */
export async function withQueueResilience<T>(fn: () => Promise<T>, opts?: { retries?: number }): Promise<T> {
  const retries = opts?.retries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
      const isRedisErr = message.toLowerCase().includes("redis") || code === "ECONNREFUSED";
      if (!isRedisErr || attempt === retries) throw err;
      const delay = Math.min(1000 * 2 ** attempt, 5000);
      appLogger.warn({ attempt, delay, err: message }, "Queue Redis transient failure, retrying");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

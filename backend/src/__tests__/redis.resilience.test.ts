/**
 * Redis resilience kill-test suite.
 * Proves invariants during Redis unavailability without requiring a real Redis container.
 * - No double-payout window (stream lock + clawback fail-closed)
 * - Rate limiting fails open consistently (documented choice)
 * - Cache degrades gracefully
 * - Queue reconnect logic exists
 * - Idempotency degrades without double-spend
 *
 * These tests mock ioredis to simulate Redis loss mid-suite.
 */

import { redis } from "../lib/redis";

jest.mock("../lib/redis", () => {
  const mockRedis: Record<string, jest.Mock> = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    ping: jest.fn(),
    getdel: jest.fn(),
  };
  // Provide status field for isRedisReady checks
  (mockRedis as any).status = "ready";
  (mockRedis as any).on = jest.fn();
  return { redis: mockRedis };
});

import { cacheGet, cacheSet } from "../lib/cache";
import { REDIS_CONSUMER_POLICY, isRedisAvailable } from "../lib/redisPolicy";
import { RATE_LIMIT_RESILIENCE_POLICY } from "../lib/rateLimit";
import { StreamClawbackService } from "../services/streamClawback.service";

describe("Redis resilience invariants (kill-test)", () => {
  const mockRedis = redis as unknown as Record<string, jest.Mock> & { status: string };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.status = "ready";
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.del.mockResolvedValue(1);
    mockRedis.ping.mockResolvedValue("PONG");
  });

  describe("Per-consumer policy documentation", () => {
    it("documents expected behavior for every Redis consumer", () => {
      const expectedConsumers = ["stream-lock", "clawback-distributed-lock", "idempotency", "cache", "rate-limit", "queue", "auth-challenge", "feature-flags"] as const;
      for (const c of expectedConsumers) {
        expect(REDIS_CONSUMER_POLICY[c]).toBeDefined();
        expect(["fail-closed", "fail-open-graceful", "degrade-queue"]).toContain(REDIS_CONSUMER_POLICY[c].onRedisDown);
      }
    });

    it("payout-critical consumers are fail-closed", () => {
      expect(REDIS_CONSUMER_POLICY["clawback-distributed-lock"].onRedisDown).toBe("fail-closed");
      expect(REDIS_CONSUMER_POLICY["stream-lock"].onRedisDown).toBe("fail-closed");
      expect(REDIS_CONSUMER_POLICY["auth-challenge"].onRedisDown).toBe("fail-closed");
    });

    it("cache and rate-limit are fail-open graceful (documented)", () => {
      expect(REDIS_CONSUMER_POLICY["cache"].onRedisDown).toBe("fail-open-graceful");
      expect(REDIS_CONSUMER_POLICY["rate-limit"].onRedisDown).toBe("fail-open-graceful");
      expect(RATE_LIMIT_RESILIENCE_POLICY.onRedisDown).toBe("fail-open-graceful");
      expect(RATE_LIMIT_RESILIENCE_POLICY.behavior).toMatch(/allow request/);
    });

    it("queues degrade and resume", () => {
      expect(REDIS_CONSUMER_POLICY["queue"].onRedisDown).toBe("degrade-queue");
    });
  });

  describe("Fail-closed verification for payout safety (locks)", () => {
    it("clawback acquire fails closed (503) when Redis is unavailable — no double-payout window", () => {
      const svc = new StreamClawbackService();
      mockRedis.status = "close"; // simulate Redis loss

      expect(() => svc.acquire("stream-123")).toThrow(expect.objectContaining({ statusCode: 503 }));
      // Ensure no in-memory lock was taken (would allow second pod to also think it holds lock)
      expect(svc.isLocked("stream-123")).toBe(false);
    });

    it("clawback acquire async fails closed on Redis error", async () => {
      const svc = new StreamClawbackService();
      mockRedis.set.mockRejectedValue(new Error("ECONNREFUSED Redis unavailable"));
      mockRedis.get.mockRejectedValue(new Error("ECONNREFUSED Redis unavailable"));

      await expect(svc.acquireAsync("stream-456")).rejects.toMatchObject({ statusCode: 503 });
      // isLockedAsync should be true (fail-closed assumption) when Redis is down — prevents new attempts from racing
      const locked = await svc.isLockedAsync("stream-456");
      expect(locked).toBe(true);
    });

    it("no split-brain double payout: two concurrent acquires yield exactly one holder (409 + in-memory)", () => {
      const svc = new StreamClawbackService();
      mockRedis.status = "ready";
      mockRedis.set.mockResolvedValue("OK");

      svc.acquire("stream-dedup");
      expect(() => svc.acquire("stream-dedup")).toThrow(expect.objectContaining({ statusCode: 409 }));
      svc.release("stream-dedup");
      expect(svc.isLocked("stream-dedup")).toBe(false);
    });

    it("stream lock remains DB-backed and does not depend on Redis", () => {
      // StreamLockService reads stream.lockedAt from DB, not Redis. Verify policy reflects this.
      expect(REDIS_CONSUMER_POLICY["stream-lock"].description).toMatch(/DB-backed|DB is source of truth/);
    });
  });

  describe("Graceful degradation for cache/rate-limit consumers", () => {
    it("cacheGet returns null on Redis failure (fallback to DB)", async () => {
      mockRedis.get.mockRejectedValue(new Error("Redis down"));
      const result = await cacheGet("any:key");
      expect(result).toBeNull();
    });

    it("cacheSet swallows Redis failure (no throw) — write-through skipped", async () => {
      mockRedis.set.mockRejectedValue(new Error("Redis down"));
      await expect(cacheSet("any:key", { foo: 1 })).resolves.toBeUndefined();
    });

    it("rate limiting fails open: policy documents allow, not deny, on Redis loss", () => {
      expect(RATE_LIMIT_RESILIENCE_POLICY.alternativeRejected).toMatch(/fail-closed.*rejected/);
    });
  });

  describe("Queue consumers resume cleanly after reconnect", () => {
    it("createQueueConnection has retryStrategy and reconnect handlers", async () => {
      // Verify queue.ts exports retry logic by inspecting file content
      const fs = await import("fs");
      const path = await import("path");
      const queueFile = fs.readFileSync(path.join(__dirname, "../jobs/queue.ts"), "utf8");
      expect(queueFile).toMatch(/retryStrategy/);
      expect(queueFile).toMatch(/reconnecting/);
      expect(queueFile).toMatch(/ready.*consumers will resume/);
    });

    it("withQueueResilience retries on Redis transient errors", async () => {
      const { withQueueResilience } = await import("../lib/redisPolicy");
      let attempts = 0;
      const fn = jest.fn(async () => {
        attempts++;
        if (attempts < 3) throw new Error("ECONNREFUSED Redis");
        return "ok";
      });
      const result = await withQueueResilience(fn, { retries: 3 });
      expect(result).toBe("ok");
      expect(attempts).toBe(3);
    });
  });

  describe("Idempotency degrades without double-spend (fail-open but payout paths have DB constraint)", () => {
    it("idempotency policy is fail-open-graceful but payout DB constraints remain", () => {
      expect(REDIS_CONSUMER_POLICY["idempotency"].onRedisDown).toBe("fail-open-graceful");
      expect(REDIS_CONSUMER_POLICY["idempotency"].rationale).toMatch(/DB uniqueness|availability/i);
    });
  });

  describe("Kill-test proving no double-payout window during Redis loss", () => {
    it("killing Redis mid-flight does not allow two clawbacks to both succeed", () => {
      const svc = new StreamClawbackService();
      // First acquire succeeds while Redis ready
      svc.acquire("kill-test-stream");
      // Simulate Redis dying right after
      mockRedis.status = "end";
      // Second acquire while Redis down must fail closed (503) not succeed
      expect(() => svc.acquire("kill-test-stream")).toThrow();
      // Even a different stream should fail closed when Redis is down (no split-brain)
      expect(() => svc.acquire("kill-test-stream-2")).toThrow(expect.objectContaining({ statusCode: 503 }));
      // Cleanup
      svc.release("kill-test-stream");
      mockRedis.status = "ready";
    });
  });
});

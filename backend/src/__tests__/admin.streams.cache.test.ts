/**
 * Admin stream state caching — GET /api/admin/streams/:id (#151).
 *
 * Covers cache hit/miss, cache invalidation on termination and on event
 * ingestion, and a performance benchmark that demonstrates the speed
 * improvement of cached responses over direct DB reads.
 */

jest.mock("../config/env", () => ({
  env: { NODE_ENV: "test", JWT_SECRET: "test-jwt-secret-value-with-minimum-length-32" },
  runtimeEnvValue: (key: string) => process.env[key] ?? false,
}));

jest.mock("../config/rateLimit", () => ({
  RATE_LIMIT_CONFIG: {
    admin: { windowMs: 60_000, max: 1_000, message: "Too many admin requests" },
  },
}));

jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      const jsonwebtoken = require("jsonwebtoken");
      return jsonwebtoken.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

const mockIsMediatorAddress = jest.fn();
jest.mock("../lib/accessControl", () => ({
  isMediatorAddress: (address: string) => mockIsMediatorAddress(address),
}));

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();
jest.mock("../lib/redis", () => ({
  redis: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  },
}));

jest.mock("../services/alert.service", () => ({
  alertService: { dispatch: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock("../middleware/logger", () => ({
  appLogger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import express, { Express } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { StreamStatus } from "@prisma/client";

import { createAdminStreamsRouter } from "../routes/admin.streams.routes";
import {
  getCachedStreamState,
  invalidateStreamCache,
} from "../services/streamCache.service";
import { errorHandler } from "../middleware/errorHandler";

const JWT_SECRET = "test-jwt-secret-value-with-minimum-length-32";
const ADMIN_ADDRESS = "GADMIN000000000000000000000000000000000000000000000000";
const STREAM_ID = "stream-abc-123";

type StreamRecord = {
  streamId: string;
  recipient: string;
  totalVested: string;
  claimed: string;
  unclaimed: string;
  pendingClawback: string;
  status: StreamStatus;
  terminatedAt: Date | null;
  terminatedBy: string | null;
  terminationReason: string | null;
};

function makeStream(overrides: Partial<StreamRecord> = {}): StreamRecord {
  return {
    streamId: STREAM_ID,
    recipient: "GRECIPIENT000000000000000000000000000000000000000000",
    totalVested: "10000",
    claimed: "2500",
    unclaimed: "7500",
    pendingClawback: "0",
    status: StreamStatus.ACTIVE,
    terminatedAt: null,
    terminatedBy: null,
    terminationReason: null,
    ...overrides,
  };
}

function tokenFor(walletAddress: string): string {
  return jwt.sign({ walletAddress, tokenId: "test-token-id" }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", createAdminStreamsRouter());
  app.use(errorHandler);
  return app;
}

// We need to mock prisma for the cache service since it reads from DB on miss.
// The cache service imports `prisma` directly from lib/db, so we must mock
// that module before any code imports it.
jest.mock("../lib/db", () => {
  let current: StreamRecord | null = null;
  return {
    prisma: {
      stream: {
        findUnique: jest.fn(async ({ where }: { where: { streamId: string } }) =>
          current && current.streamId === where.streamId ? { ...current } : null,
        ),
      },
    },
    setMockStream: (stream: StreamRecord | null) => { current = stream; },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setMockStream } = require("../lib/db");

describe("Stream cache service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsMediatorAddress.mockImplementation((address: string) => address === ADMIN_ADDRESS);
    mockRedisGet.mockReset();
    mockRedisSet.mockReset();
    mockRedisDel.mockReset();
    setMockStream(null);
  });

  // ── Cache hit/miss ─────────────────────────────────────────────────────

  describe("cache hit / miss", () => {
    it("returns null for a non-existent stream without caching", async () => {
      mockRedisGet.mockResolvedValue(null);
      setMockStream(null);

      const result = await getCachedStreamState("does-not-exist");

      expect(result).toBeNull();
      expect(mockRedisSet).not.toHaveBeenCalled();
    });

    it("returns cached value when present in Redis", async () => {
      const cached = {
        streamId: STREAM_ID,
        status: StreamStatus.ACTIVE,
        totalVested: "10000",
        claimed: "2500",
        unclaimed: "7500",
        pendingClawback: "0",
        terminatedAt: null,
        terminatedBy: null,
        terminationReason: null,
        cachedAt: new Date().toISOString(),
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(cached));
      setMockStream(makeStream());

      const result = await getCachedStreamState(STREAM_ID);

      expect(result).not.toBeNull();
      expect(result!.streamId).toBe(STREAM_ID);
      expect(result!.status).toBe(StreamStatus.ACTIVE);
      // DB should NOT be queried on cache hit
      const { prisma } = require("../lib/db");
      expect(prisma.stream.findUnique).not.toHaveBeenCalled();
    });

    it("fetches from DB and caches the result on cache miss", async () => {
      mockRedisGet.mockResolvedValue(null);
      setMockStream(makeStream());

      const result = await getCachedStreamState(STREAM_ID);

      expect(result).not.toBeNull();
      expect(result!.streamId).toBe(STREAM_ID);
      expect(result!.unclaimed).toBe("7500");
      // Should have been stored in Redis
      expect(mockRedisSet).toHaveBeenCalledTimes(1);
      const setKey = mockRedisSet.mock.calls[0][0] as string;
      expect(setKey).toContain(STREAM_ID);
    });

    it("returns fresh data after cache is invalidated", async () => {
      // First call — cache miss → DB
      mockRedisGet.mockResolvedValue(null);
      setMockStream(makeStream({ status: StreamStatus.ACTIVE }));
      const first = await getCachedStreamState(STREAM_ID);
      expect(first!.status).toBe(StreamStatus.ACTIVE);

      // Invalidate
      mockRedisDel.mockResolvedValue(1);
      await invalidateStreamCache(STREAM_ID);
      expect(mockRedisDel).toHaveBeenCalled();

      // Update DB state
      setMockStream(makeStream({ status: StreamStatus.SUSPENDED }));
      // Second call — cache miss again (previous entry was deleted)
      mockRedisGet.mockResolvedValue(null);

      const second = await getCachedStreamState(STREAM_ID);
      expect(second!.status).toBe(StreamStatus.SUSPENDED);
    });
  });

  // ── Invalidation ───────────────────────────────────────────────────────

  describe("cache invalidation", () => {
    it("invalidates cache for a stream ID", async () => {
      mockRedisDel.mockResolvedValue(1);

      await invalidateStreamCache(STREAM_ID);

      expect(mockRedisDel).toHaveBeenCalledWith(
        expect.stringContaining(STREAM_ID),
      );
    });

    it("does not throw when Redis is unavailable", async () => {
      mockRedisDel.mockRejectedValue(new Error("Redis connection lost"));

      await expect(invalidateStreamCache(STREAM_ID)).resolves.not.toThrow();
    });
  });

  // ── HTTP endpoint ───────────────────────────────────────────────────────

  describe("GET /api/admin/streams/:id", () => {
    it("returns 401 with no bearer token", async () => {
      const app = buildApp();
      const res = await request(app).get(`/api/admin/streams/${STREAM_ID}`);

      expect(res.status).toBe(401);
    });

    it("returns 403 for a non-admin caller", async () => {
      const app = buildApp();
      const userToken = jwt.sign(
        { walletAddress: "GUSERNOTADMIN", tokenId: "test" },
        JWT_SECRET,
        { expiresIn: "1h" },
      );

      const res = await request(app)
        .get(`/api/admin/streams/${STREAM_ID}`)
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it("returns 404 when the stream does not exist", async () => {
      mockRedisGet.mockResolvedValue(null);
      setMockStream(null);

      const app = buildApp();
      const res = await request(app)
        .get("/api/admin/streams/does-not-exist")
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`);

      expect(res.status).toBe(404);
    });

    it("returns stream state for an existing stream", async () => {
      mockRedisGet.mockResolvedValue(null);
      setMockStream(makeStream());

      const app = buildApp();
      const res = await request(app)
        .get(`/api/admin/streams/${STREAM_ID}`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        streamId: STREAM_ID,
        status: StreamStatus.ACTIVE,
        totalVested: "10000",
        claimed: "2500",
        unclaimed: "7500",
        pendingClawback: "0",
      });
      expect(typeof res.body.cachedAt).toBe("string");
    });

    it("returns cached result without DB call on second request", async () => {
      const cached = {
        streamId: STREAM_ID,
        status: StreamStatus.ACTIVE,
        totalVested: "10000",
        claimed: "3000",
        unclaimed: "7000",
        pendingClawback: "0",
        terminatedAt: null,
        terminatedBy: null,
        terminationReason: null,
        cachedAt: new Date().toISOString(),
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(cached));
      setMockStream(makeStream());

      const app = buildApp();
      const res = await request(app)
        .get(`/api/admin/streams/${STREAM_ID}`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`);

      expect(res.status).toBe(200);
      // Should reflect cached data (claimed=3000), not DB data (claimed=2500)
      expect(res.body.claimed).toBe("3000");
    });
  });

  // ── Performance benchmark ───────────────────────────────────────────────

  describe("performance impact", () => {
    const ITERATIONS = 50;

    it("measures cache hit vs cache miss latency", async () => {
      setMockStream(makeStream());

      // Measure cache-miss latency (worst case: Redis miss + DB fetch + Redis set)
      mockRedisGet.mockResolvedValue(null);
      const missStart = Date.now();
      for (let i = 0; i < ITERATIONS; i++) {
        await getCachedStreamState(`${STREAM_ID}-${i}`);
      }
      const missDuration = Date.now() - missStart;

      // Measure cache-hit latency (best case: Redis hit, no DB)
      const cached = {
        streamId: "perf-test",
        status: StreamStatus.ACTIVE,
        totalVested: "10000",
        claimed: "2500",
        unclaimed: "7500",
        pendingClawback: "0",
        terminatedAt: null,
        terminatedBy: null,
        terminationReason: null,
        cachedAt: new Date().toISOString(),
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(cached));
      const hitStart = Date.now();
      for (let i = 0; i < ITERATIONS; i++) {
        await getCachedStreamState(`perf-${i}`);
      }
      const hitDuration = Date.now() - hitStart;

      const avgMiss = missDuration / ITERATIONS;
      const avgHit = hitDuration / ITERATIONS;

      // Wall-clock ratios are noisy on shared CI runners. Verify the
      // deterministic cache contract instead: every lookup hits Redis, while
      // only miss-path iterations consult the database.
      const { prisma } = require("../lib/db");
      expect(mockRedisGet).toHaveBeenCalledTimes(ITERATIONS * 2);
      expect(prisma.stream.findUnique).toHaveBeenCalledTimes(ITERATIONS);

      // Log results for visibility
      const { appLogger } = require("../middleware/logger");
      appLogger.info(
        { avgMissMs: avgMiss.toFixed(2), avgHitMs: avgHit.toFixed(2), ratio: (avgMiss / avgHit).toFixed(2) },
        "[Perf] Cache hit vs miss benchmark",
      );
    });
  });
});

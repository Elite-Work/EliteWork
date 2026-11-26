/**
 * Idempotency guard tests for POST /disputes/:id/transition (ADR-004, #510).
 */

process.env.JWT_SECRET = "test-secret-at-least-32-characters-long!!";
process.env.JWT_ISSUER = "amana";
process.env.JWT_AUDIENCE = "amana-api";
process.env.DATABASE_URL = "postgresql://localhost:5432/amana_test";
process.env.AMANA_ESCROW_CONTRACT_ID =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
process.env.USDC_CONTRACT_ID =
  "CBIELTK6YBZJU5UP2WWQEUCY7PUJE7R6OB3NIUJKL5UH4WJQJ6HVHKX";

import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";

const store = new Map<string, string>();
const locks = new Set<string>();

jest.mock("../lib/redis", () => ({
  redis: {
    eval: jest.fn(async (script: string, _numKeys: number, cacheKey: string, lockKey: string, ...args: unknown[]) => {
      if (script.includes('redis.call("GET", KEYS[1])')) {
        const cached = store.get(cacheKey);
        if (cached) {
          return cached;
        }
        if (locks.has(lockKey)) {
          return 0;
        }
        locks.add(lockKey);
        return 1;
      }
      if (script.includes('redis.call("SET", KEYS[1]')) {
        store.set(cacheKey, String(args[0]));
        locks.delete(lockKey);
        return 1;
      }
      return 1;
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (key: string) => {
      locks.delete(key);
      return 1;
    }),
  },
}));

import { createDisputeRouter } from "../controllers/dispute.controller";
import { DisputeService, type DisputeResponse } from "../services/dispute.service";
import { AuthService } from "../services/auth.service";
import { errorHandler } from "../middleware/errorHandler";

jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
jest.spyOn(AuthService, "getTokenVersion").mockResolvedValue(0);

const MEDIATOR = "GCMEDIATOR0000000000000000000000000000000000000000000001";
const TRADE_ID = "trade-dispute-idem-001";

function makeToken(walletAddress: string): string {
  return jwt.sign(
    {
      walletAddress,
      jti: `jti-${walletAddress}-${Math.random()}`,
      nbf: Math.floor(Date.now() / 1000) - 1,
    },
    process.env.JWT_SECRET!,
    {
      algorithm: "HS256",
      issuer: process.env.JWT_ISSUER!,
      audience: process.env.JWT_AUDIENCE!,
    },
  );
}

const UPDATED_DISPUTE: DisputeResponse = {
  id: 42,
  tradeId: TRADE_ID,
  initiator: "GCUSER00000000000000000000000000000000000000000000000001",
  reason: "Goods not delivered",
  status: "UNDER_REVIEW",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-01-01T10:05:00.000Z",
  resolvedAt: null,
  trade: {
    buyerAddress: "GCUSER00000000000000000000000000000000000000000000000001",
    sellerAddress: "GCSELLER0000000000000000000000000000000000000000000000001",
    amountUsdc: "500",
  },
};

function buildApp() {
  const transitionSpy = jest
    .spyOn(DisputeService.prototype, "transitionDisputeStatus")
    .mockResolvedValue(UPDATED_DISPUTE);

  const app = express();
  app.use(express.json());
  app.use("/disputes", createDisputeRouter({} as never));
  app.use(errorHandler);

  return { app, transitionSpy };
}

describe("POST /disputes/:id/transition idempotency guard (ADR-004)", () => {
  beforeEach(() => {
    store.clear();
    locks.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
    jest.spyOn(AuthService, "getTokenVersion").mockResolvedValue(0);
  });

  it("returns 200 with cached response and X-Idempotency-Cache: HIT on duplicate requests with the same key", async () => {
    const { app, transitionSpy } = buildApp();
    const token = makeToken(MEDIATOR);

    const first = await request(app)
      .post(`/disputes/${TRADE_ID}/transition`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "dispute-key-1")
      .send({ status: "UNDER_REVIEW" });

    expect(first.status).toBe(200);
    expect(first.body).toEqual(UPDATED_DISPUTE);
    expect(transitionSpy).toHaveBeenCalledTimes(1);

    const second = await request(app)
      .post(`/disputes/${TRADE_ID}/transition`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "dispute-key-1")
      .send({ status: "UNDER_REVIEW" });

    expect(second.status).toBe(200);
    expect(second.headers["x-idempotency-cache"]).toBe("HIT");
    expect(second.body).toEqual(UPDATED_DISPUTE);
    expect(transitionSpy).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when the same Idempotency-Key is reused with a different request body", async () => {
    const { app, transitionSpy } = buildApp();
    const token = makeToken(MEDIATOR);

    const first = await request(app)
      .post(`/disputes/${TRADE_ID}/transition`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "dispute-key-conflict")
      .send({ status: "UNDER_REVIEW" });

    expect(first.status).toBe(200);
    expect(transitionSpy).toHaveBeenCalledTimes(1);

    const second = await request(app)
      .post(`/disputes/${TRADE_ID}/transition`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "dispute-key-conflict")
      .send({ status: "RESOLVED" });

    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/different request body/i);
    expect(transitionSpy).toHaveBeenCalledTimes(1);
  });

  it("does not cache non-2xx responses so failed attempts can be retried with the same key", async () => {
    const { app, transitionSpy } = buildApp();
    const token = makeToken(MEDIATOR);

    const invalid = await request(app)
      .post(`/disputes/${TRADE_ID}/transition`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "dispute-key-retry-after-400")
      .send({ status: "INVALID" });

    expect(invalid.status).toBe(400);
    expect(transitionSpy).not.toHaveBeenCalled();

    const retry = await request(app)
      .post(`/disputes/${TRADE_ID}/transition`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", "dispute-key-retry-after-400")
      .send({ status: "UNDER_REVIEW" });

    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(UPDATED_DISPUTE);
    expect(transitionSpy).toHaveBeenCalledTimes(1);
  });
});

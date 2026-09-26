/**
 * db.pool.exhaustion.test.ts — Issue #122
 *
 * Confirms the behavior of trade creation when Prisma's connection pool is
 * exhausted during a burst of concurrent requests:
 *
 *   - Prisma waits for a connection only up to `pool_timeout`, then rejects
 *     with `P2024` ("Timed out fetching a new connection from the connection
 *     pool").
 *   - The app does NOT queue indefinitely and does NOT auto-retry the
 *     non-idempotent INSERT.
 *   - Callers receive a clear, retryable HTTP 503 (`INFRA_ERROR` /
 *     `DB_POOL_EXHAUSTED`) instead of a generic 500.
 *
 * Expected behavior is documented in docs/connection-pool-exhaustion.md.
 */

import express from "express";
import request from "supertest";
import { Prisma, PrismaClient, TradeStatus } from "@prisma/client";

import { TradeService } from "../services/trade.service";
import { classifyError } from "../lib/retry";
import { errorHandler } from "../middleware/errorHandler";
import { AppError, ErrorCode } from "../errors/errorCodes";
import {
  DB_POOL_EXHAUSTED_REASON,
  PRISMA_POOL_EXHAUSTION_CODE,
  isPrismaPoolExhaustionError,
  toPoolExhaustionAppError,
} from "../lib/dbPoolErrors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TRADE_INPUT = {
  tradeId: "trade-pool-001",
  buyerAddress: "gbuyerpool01aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  sellerAddress: "gsellerpool01bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  amountUsdc: "100.0000000",
  buyerLossBps: 5000,
  sellerLossBps: 5000,
};

/** The exact error Prisma raises when `pool_timeout` elapses. */
function makeRealPoolExhaustionError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Timed out fetching a new connection from the connection pool. More info: http://pris.ly/d/connection-pool",
    { code: PRISMA_POOL_EXHAUSTION_CODE, clientVersion: "5.22.0" },
  );
}

function makePrismaStub(createImpl: (args: unknown) => Promise<unknown>): PrismaClient {
  return {
    trade: {
      create: jest.fn(createImpl),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
    },
  } as unknown as PrismaClient;
}

function expectPoolExhaustedAppError(error: unknown): void {
  expect(error).toBeInstanceOf(AppError);
  const appError = error as AppError;
  expect(appError.code).toBe(ErrorCode.INFRA_ERROR);
  expect(appError.statusCode).toBe(503);
  expect(appError.details).toMatchObject({
    reason: DB_POOL_EXHAUSTED_REASON,
    retryable: true,
    operation: "create_pending_trade",
  });
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

describe("isPrismaPoolExhaustionError", () => {
  it("detects the real PrismaClientKnownRequestError P2024 shape", () => {
    expect(isPrismaPoolExhaustionError(makeRealPoolExhaustionError())).toBe(true);
  });

  it("detects a bare error-like object carrying code P2024", () => {
    expect(isPrismaPoolExhaustionError({ code: PRISMA_POOL_EXHAUSTION_CODE })).toBe(true);
  });

  it("falls back to the pool-timeout message when the code is stripped", () => {
    expect(
      isPrismaPoolExhaustionError({
        message: "Timed out fetching a new connection from the connection pool",
      }),
    ).toBe(true);
  });

  it("does not misclassify other Prisma/application errors", () => {
    expect(isPrismaPoolExhaustionError({ code: "P2002" })).toBe(false);
    expect(isPrismaPoolExhaustionError(new Error("constraint violation"))).toBe(false);
    expect(isPrismaPoolExhaustionError(null)).toBe(false);
    expect(isPrismaPoolExhaustionError(undefined)).toBe(false);
    expect(isPrismaPoolExhaustionError("P2024")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Burst load — fail fast, no queueing, no auto-retry
// ---------------------------------------------------------------------------

describe("Trade creation under a connection-pool-exhausting burst", () => {
  it("rejects every request with a clear retryable 503 and inserts exactly once per request", async () => {
    const prisma = makePrismaStub(() => Promise.reject(makeRealPoolExhaustionError()));
    const service = new TradeService(prisma, {} as never);

    const BURST_SIZE = 50;
    const settled = await Promise.allSettled(
      Array.from({ length: BURST_SIZE }, (_, i) =>
        service.createPendingTrade({ ...TRADE_INPUT, tradeId: `trade-pool-${i}` }),
      ),
    );

    // Fail fast: every request settled, none hung waiting for a connection.
    expect(settled).toHaveLength(BURST_SIZE);
    expect(settled.every((result) => result.status === "rejected")).toBe(true);

    for (const result of settled) {
      if (result.status === "rejected") {
        expectPoolExhaustedAppError(result.reason);
      }
    }

    // Exactly one DB attempt per request: no hidden retry loop, no queue that
    // re-runs the non-idempotent INSERT later.
    expect((prisma.trade.create as jest.Mock)).toHaveBeenCalledTimes(BURST_SIZE);

    // The raw Prisma error must not leak through to the caller.
    const firstRejection = settled[0] as PromiseRejectedResult;
    expect((firstRejection.reason as Error).message).toContain("connection pool exhausted");
    expect((firstRejection.reason as { code?: string }).code).toBe(ErrorCode.INFRA_ERROR);
  });

  it("never auto-retries the non-idempotent INSERT even though P2024 is classified retryable", async () => {
    const error = makeRealPoolExhaustionError();

    // Cross-check: the shared retry wrapper would consider the error retryable…
    expect(classifyError(error)).toBe(true);

    // …but trade creation must still attempt the INSERT exactly once.
    const prisma = makePrismaStub(() => Promise.reject(error));
    const service = new TradeService(prisma, {} as never);

    await expect(service.createPendingTrade(TRADE_INPUT)).rejects.toBeInstanceOf(AppError);
    expect((prisma.trade.create as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it("recovers once the pool frees up instead of wedging the trade-creation path", async () => {
    const createdTrade = { ...TRADE_INPUT, status: TradeStatus.PENDING_SIGNATURE };

    let attempts = 0;
    const prisma = makePrismaStub(() => {
      attempts += 1;
      return attempts <= 2
        ? Promise.reject(makeRealPoolExhaustionError())
        : Promise.resolve(createdTrade);
    });
    const service = new TradeService(prisma, {} as never);

    await expect(service.createPendingTrade(TRADE_INPUT)).rejects.toBeInstanceOf(AppError);
    await expect(service.createPendingTrade(TRADE_INPUT)).rejects.toBeInstanceOf(AppError);

    // Third attempt: pool has drained, trade is persisted normally.
    await expect(service.createPendingTrade(TRADE_INPUT)).resolves.toMatchObject({
      tradeId: TRADE_INPUT.tradeId,
    });
    expect(attempts).toBe(3);
  });

  it("passes non-pool Prisma errors through unchanged", async () => {
    const constraintError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`tradeId`)",
      { code: "P2002", clientVersion: "5.22.0" },
    );
    const prisma = makePrismaStub(() => Promise.reject(constraintError));
    const service = new TradeService(prisma, {} as never);

    await expect(service.createPendingTrade(TRADE_INPUT)).rejects.toBe(constraintError);
  });
});

// ---------------------------------------------------------------------------
// API boundary — the 503 payload is clear and machine-readable
// ---------------------------------------------------------------------------

describe("Pool exhaustion at the HTTP boundary", () => {
  const app = express();
  app.use(express.json());
  app.get("/trades", () => {
    throw toPoolExhaustionAppError("create_pending_trade");
  });
  app.use(errorHandler);

  it("renders a 503 with the retryable DB_POOL_EXHAUSTED reason", async () => {
    const res = await request(app).get("/trades");

    expect(res.status).toBe(503);
    expect(res.body.code).toBe(ErrorCode.INFRA_ERROR);
    expect(res.body.details).toMatchObject({
      reason: DB_POOL_EXHAUSTED_REASON,
      retryable: true,
    });
    expect(res.body.message).toMatch(/connection pool exhausted/i);
    expect(res.body.timestamp).toBeDefined();
  });
});

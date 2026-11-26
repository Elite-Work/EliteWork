import express, { type NextFunction, type Response } from "express";
import request from "supertest";
import { redis } from "../lib/redis";
import { IDEMPOTENCY_ACQUIRE_SCRIPT } from "../middleware/idempotency";
import type { AuthRequest } from "../services/auth.service";
import { createEscrowFundsReleaseRouter, createTradeRouter } from "../routes/trade.routes";

jest.mock("../controllers/trade.controller", () => {
  const releaseFunds = jest.fn();
  return {
    releaseFunds,
    TradeController: jest.fn(() => ({
      buildDepositTx: jest.fn(),
      confirmDelivery: jest.fn(),
      createBulkTrades: jest.fn(),
      createTrade: jest.fn(),
      initiateDispute: jest.fn(),
      releaseFunds,
    })),
  };
});
jest.mock("../lib/redis", () => ({ redis: { eval: jest.fn() } }));
jest.mock("../middleware/auth.middleware", () => ({
  authMiddleware: (req: AuthRequest, res: Response, next: NextFunction) => {
    const walletAddress = req.get("Authorization");
    if (!walletAddress) {
      res.sendStatus(401);
      return;
    }
    req.user = { walletAddress } as NonNullable<typeof req.user>;
    next();
  },
}));

it("replays a release response once per authenticated wallet and key", async () => {
  const cache = new Map<string, string>();
  jest.mocked(redis.eval).mockImplementation(
    async (script: string, _keyCount: number, cacheKey: string, _lockKey: string, payload: string) => {
      if (script === IDEMPOTENCY_ACQUIRE_SCRIPT) return cache.get(cacheKey) ?? 1;
      cache.set(cacheKey, payload);
      return 1;
    },
  );

  const { releaseFunds } = jest.requireMock<{ releaseFunds: jest.Mock }>(
    "../controllers/trade.controller",
  );
  releaseFunds.mockImplementation(async (req: AuthRequest, res: Response) => {
    res.status(200).json({ unsignedXdr: `unsigned-for-${req.params.id}-${req.user?.walletAddress}` });
  });

  const app = express();
  app.use(express.json());
  app.use("/api/escrow", createEscrowFundsReleaseRouter());
  app.use("/trades", createTradeRouter());

  const release = (wallet: string, tradeId = "trade-1") => request(app)
    .post("/api/escrow/release")
    .set("Authorization", wallet)
    .set("Idempotency-Key", "release-once")
    .send({ tradeId });

  const first = await release("buyer").expect(200);
  const replay = await release("buyer").expect(200).expect("X-Idempotency-Cache", "HIT");
  expect(replay.body).toEqual(first.body);

  const legacyReplay = await request(app)
    .post("/trades/trade-1/release")
    .set("Authorization", "buyer")
    .set("Idempotency-Key", "release-once")
    .expect(200)
    .expect("X-Idempotency-Cache", "HIT");
  expect(legacyReplay.body).toEqual(first.body);
  await release("buyer", "trade-2").expect(409);
  expect(releaseFunds).toHaveBeenCalledTimes(1);

  const otherWallet = await release("other-wallet").expect(200);
  expect(otherWallet.body).toEqual({ unsignedXdr: "unsigned-for-trade-1-other-wallet" });
  expect(releaseFunds).toHaveBeenCalledTimes(2);
});

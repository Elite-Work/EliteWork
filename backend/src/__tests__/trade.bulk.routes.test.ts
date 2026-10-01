import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { Trade, TradeStatus } from "@prisma/client";
import { tradeRoutes } from "../routes/trade.routes";
import { ContractService } from "../services/contract.service";
import { TradeService } from "../services/trade.service";
import { AuthService } from "../services/auth.service";
import { errorHandler } from "../middleware/errorHandler";
import { ErrorCode } from "../errors/errorCodes";
import {
  __resetPilotMetricsForTests,
  __setPilotRecorderForTests,
  PilotMetricsRecorder,
} from "../lib/metrics";

jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      const jwt = require("jsonwebtoken");
      return jwt.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

function createMockTradeService() {
  return {
    createPendingTrade: jest.spyOn(TradeService.prototype, "createPendingTrade"),
  };
}

function createMockContractService() {
  return {
    buildCreateTradeTx: jest.spyOn(
      ContractService.prototype,
      "buildCreateTradeTx",
    ),
  };
}

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 1,
    tradeId: "trade-1",
    buyerAddress: "",
    sellerAddress: "",
    amountUsdc: "10",
    buyerLossBps: 5000,
    sellerLossBps: 5000,
    version: 0,
    status: TradeStatus.PENDING_SIGNATURE,
    fundedAt: null,
    deliveredAt: null,
    completedAt: null,
    expiresAt: null,
    expiredAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const mockTradeService = createMockTradeService();
const mockContractService = createMockContractService();

const app = express();
app.use(express.json());
app.use("/trades", tradeRoutes);
app.use(errorHandler);

describe("POST /trades/bulk (issue #45)", () => {
  const buyerAddress = StellarSdk.Keypair.random().publicKey();
  const sellerA = StellarSdk.Keypair.random().publicKey();
  const sellerB = StellarSdk.Keypair.random().publicKey();
  let token: string;

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
    process.env.JWT_ISSUER = process.env.JWT_ISSUER || "amana";
    process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || "amana-api";
    const secret = process.env.JWT_SECRET!;
    const now = Math.floor(Date.now() / 1000);
    token = jwt.sign(
      {
        walletAddress: buyerAddress,
        jti: "trade-bulk-buyer-jti",
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        nbf: now - 1,
      },
      secret,
      { algorithm: "HS256" },
    );
  });

  beforeEach(() => {
    jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
    mockTradeService.createPendingTrade.mockReset();
    mockContractService.buildCreateTradeTx.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function row(sellerAddress: string, amountUsdc = "10") {
    return { sellerAddress, amountUsdc, buyerLossBps: 5000, sellerLossBps: 5000 };
  }

  it("creates every row and returns per-row tradeIds (200)", async () => {
    mockContractService.buildCreateTradeTx
      .mockResolvedValueOnce({ tradeId: "t-1", unsignedXdr: "XDR-1" })
      .mockResolvedValueOnce({ tradeId: "t-2", unsignedXdr: "XDR-2" });
    mockTradeService.createPendingTrade
      .mockResolvedValueOnce(makeTrade({ tradeId: "t-1" }))
      .mockResolvedValueOnce(makeTrade({ tradeId: "t-2" }));

    const res = await request(app)
      .post("/trades/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send({ trades: [row(sellerA), row(sellerB, "25.5")] });

    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(2);
    expect(res.body.created[0]).toEqual({ index: 0, tradeId: "t-1", unsignedXdr: "XDR-1" });
    expect(res.body.failed).toEqual([]);
    // Buyer always comes from the JWT, never the row.
    expect(mockContractService.buildCreateTradeTx).toHaveBeenCalledWith(
      expect.objectContaining({ buyerAddress, sellerAddress: sellerA }),
    );
  });

  it("reports a failing row without aborting the batch", async () => {
    mockContractService.buildCreateTradeTx
      .mockRejectedValueOnce(new Error("simulate failed"))
      .mockResolvedValueOnce({ tradeId: "t-2", unsignedXdr: "XDR-2" });
    mockTradeService.createPendingTrade.mockResolvedValue(
      makeTrade({ tradeId: "t-2" }),
    );

    const res = await request(app)
      .post("/trades/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send({ trades: [row(sellerA), row(sellerB)] });

    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(1);
    expect(res.body.created[0].index).toBe(1);
    expect(res.body.failed).toEqual([{ index: 0, error: "simulate failed" }]);
  });

  it("rejects an empty batch with VALIDATION_ERROR", async () => {
    const res = await request(app)
      .post("/trades/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send({ trades: [] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it("rejects a batch larger than 50 rows", async () => {
    const res = await request(app)
      .post("/trades/bulk")
      .set("Authorization", `Bearer ${token}`)
      .send({ trades: Array.from({ length: 51 }, () => row(sellerA)) });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it("requires auth", async () => {
    const res = await request(app).post("/trades/bulk").send({ trades: [row(sellerA)] });
    expect(res.status).toBe(401);
  });

  describe("cooperative attribution (issue #46)", () => {
    const coop = "kebbi-coop";
    let pilotRecorder: PilotMetricsRecorder & {
      tradeEvents: Array<{ cooperative: string; region: string; event: string }>;
      gmvRecords: Array<{ cooperative: string; region: string; amountUsdc: string }>;
      bulkRecords: Array<{ outcome: string; count: number }>;
    };

    beforeEach(() => {
      const tradeEvents: Array<{ cooperative: string; region: string; event: string }> = [];
      const gmvRecords: Array<{ cooperative: string; region: string; amountUsdc: string }> = [];
      const bulkRecords: Array<{ outcome: string; count: number }> = [];
      pilotRecorder = {
        tradeEvents,
        gmvRecords,
        bulkRecords,
        recordCooperativeTradeEvent: (cooperative, region, event) => {
          tradeEvents.push({ cooperative, region, event });
        },
        recordCooperativeGmv: (cooperative, region, amountUsdc) => {
          gmvRecords.push({ cooperative, region, amountUsdc });
        },
        recordBulkImport: (outcome, count) => {
          bulkRecords.push({ outcome, count });
        },
      };
      __setPilotRecorderForTests(pilotRecorder);
    });

    afterEach(() => {
      __resetPilotMetricsForTests();
      delete process.env.COOPERATIVE_ADMINS;
      delete process.env.COOPERATIVE_MEMBERS;
    });

    it("records per-cooperative metrics when the caller belongs to the cooperative", async () => {
      process.env.COOPERATIVE_ADMINS = `${coop}:${buyerAddress}`;
      mockContractService.buildCreateTradeTx.mockResolvedValue({
        tradeId: "t-1",
        unsignedXdr: "XDR-1",
      });
      mockTradeService.createPendingTrade.mockResolvedValue(
        makeTrade({ tradeId: "t-1" }),
      );

      const res = await request(app)
        .post("/trades/bulk")
        .set("Authorization", `Bearer ${token}`)
        .send({ trades: [row(sellerA, "12.5")], cooperativeId: coop, region: "kebbi" });

      expect(res.status).toBe(200);
      expect(pilotRecorder.tradeEvents).toEqual([{ cooperative: coop, region: "kebbi", event: "created" }]);
      expect(pilotRecorder.gmvRecords).toEqual([
        { cooperative: coop, region: "kebbi", amountUsdc: "12.5000000" },
      ]);
    });

    it("skips attribution when the caller does not belong to the cooperative", async () => {
      process.env.COOPERATIVE_ADMINS = `${coop}:${sellerA}`;
      process.env.COOPERATIVE_MEMBERS = `${coop}:${sellerB}`;
      mockContractService.buildCreateTradeTx.mockResolvedValue({
        tradeId: "t-1",
        unsignedXdr: "XDR-1",
      });
      mockTradeService.createPendingTrade.mockResolvedValue(
        makeTrade({ tradeId: "t-1" }),
      );

      const res = await request(app)
        .post("/trades/bulk")
        .set("Authorization", `Bearer ${token}`)
        .send({ trades: [row(sellerA)], cooperativeId: coop });

      expect(res.status).toBe(200);
      expect(res.body.created).toHaveLength(1);
      expect(pilotRecorder.tradeEvents).toEqual([]);
      expect(pilotRecorder.gmvRecords).toEqual([]);
    });
  });
});

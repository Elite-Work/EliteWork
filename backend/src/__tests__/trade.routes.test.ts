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
    getTradeById: jest.spyOn(TradeService.prototype, "getTradeById"),
  };
}

function createMockContractService() {
  return {
    buildCreateTradeTx: jest.spyOn(
      ContractService.prototype,
      "buildCreateTradeTx",
    ),
    buildDepositTx: jest.spyOn(ContractService.prototype, "buildDepositTx"),
  };
}

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 1,
    tradeId: "4294967297",
    buyerAddress: "",
    sellerAddress: "",
    amountUsdc: "125.1234567",
    buyerLossBps: 5000,
    sellerLossBps: 5000,
    version: 0,
    status: TradeStatus.CREATED,
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

describe("Trade Routes", () => {
  const buyerAddress = StellarSdk.Keypair.random().publicKey();
  const sellerAddress = StellarSdk.Keypair.random().publicKey();
  let token: string;
  let sellerToken: string;

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
    process.env.JWT_ISSUER = process.env.JWT_ISSUER || "amana";
    process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || "amana-api";
    const secret = process.env.JWT_SECRET!;
    const now = Math.floor(Date.now() / 1000);
    token = jwt.sign(
      {
        walletAddress: buyerAddress,
        jti: "trade-routes-buyer-jti",
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        nbf: now - 1,
      },
      secret,
      { algorithm: "HS256" },
    );
    sellerToken = jwt.sign(
      {
        walletAddress: sellerAddress,
        jti: "trade-routes-seller-jti",
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
    mockTradeService.getTradeById.mockReset().mockResolvedValue(null);
    mockContractService.buildCreateTradeTx.mockReset();
    mockContractService.buildDepositTx.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns 201 with tradeId and unsignedXdr for a valid request", async () => {
    mockContractService.buildCreateTradeTx.mockResolvedValue({
      tradeId: "4294967297",
      unsignedXdr: "AAAA-test-xdr",
    });
    mockTradeService.createPendingTrade.mockResolvedValue(
      makeTrade({ tradeId: "4294967297" }),
    );

    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${token}`)
      .send({
        sellerAddress,
        amountUsdc: "125.1234567",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      tradeId: "4294967297",
      unsignedXdr: "AAAA-test-xdr",
    });
    expect(mockContractService.buildCreateTradeTx).toHaveBeenCalledWith({
      buyerAddress,
      sellerAddress,
      amountUsdc: "125.1234567",
      buyerLossBps: expect.any(Number),
      sellerLossBps: expect.any(Number),
    });
    expect(mockTradeService.createPendingTrade).toHaveBeenCalledWith({
      tradeId: "4294967297",
      buyerAddress: buyerAddress,
      sellerAddress: sellerAddress,
      amountUsdc: "125.1234567",
      buyerLossBps: expect.any(Number),
      sellerLossBps: expect.any(Number),
    });
  });

  it("returns 400 with structured error for an invalid sellerAddress", async () => {
    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${token}`)
      .send({
        sellerAddress: "not-a-stellar-address",
        amountUsdc: "10",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      details: expect.any(Object),
    });
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).post("/trades").send({
      sellerAddress,
      amountUsdc: "10",
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing Authorization header");
  });

  it("returns unsignedXdr for a valid buyer deposit request", async () => {
    mockTradeService.getTradeById.mockResolvedValue(makeTrade({
      tradeId: "4294967297",
      buyerAddress: buyerAddress,
      sellerAddress: sellerAddress,
      amountUsdc: "125.1234567",
      status: TradeStatus.CREATED,
    }));
    mockContractService.buildDepositTx.mockResolvedValue({
      unsignedXdr: "AAAA-deposit-xdr",
    });

    const res = await request(app)
      .post("/trades/4294967297/deposit")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      unsignedXdr: "AAAA-deposit-xdr",
    });
    expect(mockTradeService.getTradeById).toHaveBeenCalledWith(
      "4294967297",
      buyerAddress
    );
    expect(mockContractService.buildDepositTx).toHaveBeenCalledWith(
      expect.objectContaining({
        tradeId: "4294967297",
        buyerAddress: buyerAddress,
      })
    );
  });

  it("returns 403 with structured error if the caller is the seller", async () => {
    mockTradeService.getTradeById.mockResolvedValue(makeTrade({
      tradeId: "4294967297",
      buyerAddress: buyerAddress,
      sellerAddress: sellerAddress,
      amountUsdc: "125.1234567",
      status: TradeStatus.CREATED,
    }));

    const res = await request(app)
      .post("/trades/4294967297/deposit")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ErrorCode.TRADE_ACCESS_DENIED);
    expect(res.body.timestamp).toBeDefined();
  });

  it("returns 400 with structured error if the trade is already funded", async () => {
    mockTradeService.getTradeById.mockResolvedValue(makeTrade({
      tradeId: "4294967297",
      buyerAddress: buyerAddress,
      sellerAddress: sellerAddress,
      amountUsdc: "125.1234567",
      status: TradeStatus.FUNDED,
    }));

    const res = await request(app)
      .post("/trades/4294967297/deposit")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.TRADE_INVALID_STATUS);
    expect(res.body.details).toHaveProperty("currentStatus", "FUNDED");
    expect(res.body.timestamp).toBeDefined();
  });

  it("does not create a pending trade when create_trade contract build fails", async () => {
    mockContractService.buildCreateTradeTx.mockRejectedValue(
      new Error("simulate failed"),
    );

    const res = await request(app)
      .post("/trades")
      .set("Authorization", `Bearer ${token}`)
      .send({
        sellerAddress,
        amountUsdc: "125.1234567",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
      });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe(ErrorCode.TRADE_BUILD_FAILED);
    expect(mockTradeService.createPendingTrade).not.toHaveBeenCalled();
  });
});

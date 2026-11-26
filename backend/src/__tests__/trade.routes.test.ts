import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { Trade, TradeStatus } from "@prisma/client";
import { tradeRoutes } from "../routes/trade.routes";
import { ContractService } from "../services/contract.service";
import { TradeAccessDeniedError, TradeService } from "../services/trade.service";
import { AuthService } from "../services/auth.service";
import { generateTradeReceiptPdf } from "../services/tradeReceipt.service";
import { InvalidCursorError } from "../lib/cursorPagination";
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

// The receipt route is the only handler here that touches Prisma directly
// (for the settlement txHash); keep it off the network in tests.
jest.mock("../lib/db", () => ({
  prisma: {
    trade: { findUnique: jest.fn(), findFirst: jest.fn() },
    tradeNote: { findMany: jest.fn(), update: jest.fn() },
    deliveryManifest: { findUnique: jest.fn(), update: jest.fn() },
    payoutIntent: { findFirst: jest.fn().mockResolvedValue(null) },
  },
}));

jest.mock("../services/tradeReceipt.service", () => {
  const actual = jest.requireActual("../services/tradeReceipt.service");
  return {
    ...actual,
    generateTradeReceiptPdf: jest
      .fn()
      .mockResolvedValue(Buffer.from("%PDF-1.4 test receipt")),
  };
});

function createMockTradeService() {
  return {
    createPendingTrade: jest.spyOn(TradeService.prototype, "createPendingTrade"),
    getTradeById: jest.spyOn(TradeService.prototype, "getTradeById"),
    listUserTrades: jest.spyOn(TradeService.prototype, "listUserTrades"),
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
    commodity: null,
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
    (generateTradeReceiptPdf as jest.Mock).mockClear();
    mockTradeService.listUserTrades.mockReset().mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
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
      commodity: null,
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
    expect(res.body.message).toMatch(/sellerAddress/i);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  describe("GET /trades search (#504)", () => {
    it("forwards q to the service alongside the caller's filters", async () => {
      const res = await request(app)
        .get("/trades?q=maize&page=2&limit=10")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(mockTradeService.listUserTrades).toHaveBeenCalledWith(
        buyerAddress,
        expect.objectContaining({ q: "maize", page: 2, limit: 10 }),
      );
    });

    it("treats a blank q as no search filter", async () => {
      const res = await request(app)
        .get("/trades?q=%20%20")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(mockTradeService.listUserTrades).toHaveBeenCalledWith(
        buyerAddress,
        expect.objectContaining({ q: undefined }),
      );
    });

    it("rejects a q longer than 100 characters", async () => {
      const res = await request(app)
        .get(`/trades?q=${"a".repeat(101)}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(mockTradeService.listUserTrades).not.toHaveBeenCalled();
    });
  });

  describe("GET /trades cursor pagination (#502)", () => {
    it("forwards the cursor and uses the cursor envelope without a warning", async () => {
      mockTradeService.listUserTrades.mockResolvedValueOnce({
        items: [],
        pageInfo: { nextCursor: null, hasNextPage: false, limit: 20 },
      });

      const res = await request(app)
        .get("/trades?cursor=abc&limit=20")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.pageInfo).toEqual({ nextCursor: null, hasNextPage: false, limit: 20 });
      expect(res.headers.warning).toBeUndefined();
      expect(mockTradeService.listUserTrades).toHaveBeenCalledWith(
        buyerAddress,
        expect.objectContaining({ cursor: "abc", limit: 20 }),
      );
    });

    it("defaults to cursor mode when no page is supplied", async () => {
      const res = await request(app)
        .get("/trades")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(mockTradeService.listUserTrades).toHaveBeenCalledWith(
        buyerAddress,
        expect.objectContaining({ page: undefined }),
      );
    });

    it("warns legacy page/limit clients that offset pagination is deprecated", async () => {
      const res = await request(app)
        .get("/trades?page=2&limit=10")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.headers.warning).toContain("offset pagination is deprecated");
    });

    it("returns 400 for a malformed cursor instead of leaking the decoder error", async () => {
      mockTradeService.listUserTrades.mockRejectedValueOnce(new InvalidCursorError());

      const res = await request(app)
        .get("/trades?cursor=%%%")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cursor/i);
    });
  });

  describe("GET /trades/:id/receipt (#500)", () => {
    it("returns a PDF attachment for a trade the caller can access", async () => {
      mockTradeService.getTradeById.mockResolvedValueOnce(
        makeTrade({ tradeId: "42", status: TradeStatus.COMPLETED }),
      );

      const res = await request(app)
        .get("/trades/42/receipt")
        .set("Authorization", `Bearer ${token}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => callback(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(res.headers["content-disposition"]).toContain("trade-42-receipt.pdf");
      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect(generateTradeReceiptPdf).toHaveBeenCalledWith(
        expect.objectContaining({ tradeId: "42", status: TradeStatus.COMPLETED }),
        expect.any(String),
      );
    });

    it("returns a JSON attachment when format=json (#499)", async () => {
      mockTradeService.getTradeById.mockResolvedValueOnce(
        makeTrade({ tradeId: "42", status: TradeStatus.COMPLETED }),
      );

      const res = await request(app)
        .get("/trades/42/receipt?format=json")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/json");
      expect(res.headers["content-disposition"]).toContain("trade-42-receipt.json");
      expect(res.body).toEqual(
        expect.objectContaining({
          tradeId: "42",
          amountUsdc: "125.1234567",
          status: TradeStatus.COMPLETED,
          completedAt: null,
          txHash: null,
          network: "testnet",
        }),
      );
    });

    it("rejects an unsupported format", async () => {
      const res = await request(app)
        .get("/trades/42/receipt?format=xml")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(mockTradeService.getTradeById).not.toHaveBeenCalled();
    });

    it("returns 404 when the trade does not exist", async () => {
      mockTradeService.getTradeById.mockResolvedValueOnce(null);

      const res = await request(app)
        .get("/trades/missing/receipt")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it("returns 403 when the caller is not a party to the trade", async () => {
      mockTradeService.getTradeById.mockRejectedValueOnce(new TradeAccessDeniedError());

      const res = await request(app)
        .get("/trades/secret/receipt")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
    });
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).post("/trades").send({
      sellerAddress,
      amountUsdc: "10",
    });

    expect(res.status).toBe(401);
    // Structured auth error from AuthHelper: the peer-visible message names the
    // missing header instead of the old generic "Unauthorized".
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

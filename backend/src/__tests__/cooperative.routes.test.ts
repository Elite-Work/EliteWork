import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createCooperativeRouter } from "../routes/cooperative.routes";
import { TradeService } from "../services/trade.service";
import { AuthService } from "../services/auth.service";
import { errorHandler } from "../middleware/errorHandler";

jest.mock("../services/trade.service");
jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      const jwt = require("jsonwebtoken");
      return jwt.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

const COOP = "kebbi-coop";
const adminAddress = StellarSdk.Keypair.random().publicKey();
const memberAddress = StellarSdk.Keypair.random().publicKey();
const outsiderAddress = StellarSdk.Keypair.random().publicKey();
const globalAdminAddress = StellarSdk.Keypair.random().publicKey();

const app = express();
app.use(express.json());
app.use("/cooperatives", createCooperativeRouter());
app.use(errorHandler);

function signToken(walletAddress: string, jti: string): string {
  const secret = process.env.JWT_SECRET!;
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      walletAddress,
      jti,
      iss: process.env.JWT_ISSUER,
      aud: process.env.JWT_AUDIENCE,
      nbf: now - 1,
    },
    secret,
    { algorithm: "HS256" },
  );
}

describe("GET /cooperatives/:id/trades (issue #44)", () => {
  let adminToken: string;
  let outsiderToken: string;
  let globalAdminToken: string;

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
    process.env.JWT_ISSUER = process.env.JWT_ISSUER || "amana";
    process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || "amana-api";
    process.env.ADMIN_STELLAR_PUBKEYS = globalAdminAddress;
    process.env.COOPERATIVE_ADMINS = `${COOP}:${adminAddress}`;
    process.env.COOPERATIVE_MEMBERS = `${COOP}:${memberAddress}`;

    adminToken = signToken(adminAddress, "coop-admin-jti");
    outsiderToken = signToken(outsiderAddress, "coop-outsider-jti");
    globalAdminToken = signToken(globalAdminAddress, "coop-global-admin-jti");
  });

  beforeEach(() => {
    jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
    (TradeService.prototype.listCooperativeTrades as jest.Mock).mockResolvedValue({
      items: [{ tradeId: "t-1" }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns member trades for a cooperative-admin (200)", async () => {
    const res = await request(app)
      .get(`/cooperatives/${COOP}/trades`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.cooperativeId).toBe(COOP);
    expect(res.body.items).toEqual([{ tradeId: "t-1" }]);
    expect(TradeService.prototype.listCooperativeTrades).toHaveBeenCalledWith(
      [memberAddress.toLowerCase()],
      expect.objectContaining({ page: 1, limit: 20 }),
    );
  });

  it("returns member trades for a global admin (200)", async () => {
    const res = await request(app)
      .get(`/cooperatives/${COOP}/trades`)
      .set("Authorization", `Bearer ${globalAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ tradeId: "t-1" }]);
  });

  it("rejects outsiders with 403", async () => {
    const res = await request(app)
      .get(`/cooperatives/${COOP}/trades`)
      .set("Authorization", `Bearer ${outsiderToken}`);

    expect(res.status).toBe(403);
    expect(TradeService.prototype.listCooperativeTrades).not.toHaveBeenCalled();
  });

  it("requires auth", async () => {
    const res = await request(app).get(`/cooperatives/${COOP}/trades`);
    expect(res.status).toBe(401);
  });
});

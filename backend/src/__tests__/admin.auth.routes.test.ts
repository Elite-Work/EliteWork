import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createAdminAuthRouter } from "../routes/admin.auth.routes";
import { AuthService } from "../services/auth.service";
import { errorHandler } from "../middleware/errorHandler";

jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      const jwt = require("jsonwebtoken");
      return jwt.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

const app = express();
app.use(express.json());
app.use("/", createAdminAuthRouter());
app.use(errorHandler);

describe("GET /api/admin/auth/claims", () => {
  const adminAddress = StellarSdk.Keypair.random().publicKey();
  const nonAdminAddress = StellarSdk.Keypair.random().publicKey();
  let adminToken: string;
  let nonAdminToken: string;
  let issuedAtSeconds: number;
  let expiresAtSeconds: number;

  function signToken(walletAddress: string, jti: string): string {
    const secret = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
    const now = Math.floor(Date.now() / 1000);
    issuedAtSeconds = now - 1;
    expiresAtSeconds = now + 3600;
    return jwt.sign(
      {
        walletAddress,
        jti,
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        nbf: now - 1,
        iat: issuedAtSeconds,
        exp: expiresAtSeconds,
      },
      secret,
      { algorithm: "HS256" },
    );
  }

  beforeAll(() => {
    process.env.ADMIN_STELLAR_PUBKEYS = adminAddress;
    adminToken = signToken(adminAddress, "claims-admin-jti");
    nonAdminToken = signToken(nonAdminAddress, "claims-nonadmin-jti");
  });

  beforeEach(() => {
    jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
    jest.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/admin/auth/claims");
    expect(res.status).toBe(401);
  });

  it("returns 401 for a malformed bearer token", async () => {
    const res = await request(app)
      .get("/api/admin/auth/claims")
      .set("Authorization", "Bearer not-a-real-jwt");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a valid token whose wallet is not an admin", async () => {
    const res = await request(app)
      .get("/api/admin/auth/claims")
      .set("Authorization", `Bearer ${nonAdminToken}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/admin access required/i);
    expect(res.body.code).toBe("AUTH_ERROR");
  });

  it("returns sanitized claims for an authorized admin wallet", async () => {
    const res = await request(app)
      .get("/api/admin/auth/claims")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      walletAddress: adminAddress,
      tokenId: "claims-admin-jti",
      issuedAt: new Date(issuedAtSeconds * 1000).toISOString(),
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      issuer: process.env.JWT_ISSUER ?? null,
      audience: process.env.JWT_AUDIENCE ?? null,
      tier: null,
      deviceBound: false,
    });
  });

  it("does not leak raw JWT fields like nbf or sub", async () => {
    const res = await request(app)
      .get("/api/admin/auth/claims")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("nbf");
    expect(res.body).not.toHaveProperty("sub");
  });
});

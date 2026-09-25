import express, { Express } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";

import { adminFeatureGate } from "../middleware/adminFeatureGate.middleware";
import { createAdminFeaturesRouter } from "../routes/admin.features.routes";
import { createAdminAuthRouter } from "../routes/admin.auth.routes";
import { createAdminStreamsRouter } from "../routes/admin.streams.routes";
import { errorHandler } from "../middleware/errorHandler";
import { env } from "../config/env";

jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      const jsonwebtoken = require("jsonwebtoken");
      return jsonwebtoken.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

jest.mock("../services/feature-flags.service", () => ({
  featureFlagService: {
    listFlags: jest.fn().mockResolvedValue({}),
    setFlag: jest.fn().mockResolvedValue({ enabled: true }),
  },
}));

const adminAddress = StellarSdk.Keypair.random().publicKey();

function signToken(walletAddress: string): string {
  const secret = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { walletAddress, jti: "gate-test", iss: "amana", aud: "amana-api", nbf: now - 1 },
    secret,
    { algorithm: "HS256" },
  );
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(adminFeatureGate, createAdminFeaturesRouter());
  app.use(adminFeatureGate, createAdminAuthRouter());
  app.use("/api", adminFeatureGate, createAdminStreamsRouter());
  app.use(errorHandler);
  return app;
}

describe("admin route feature flag gating (#15)", () => {
  let adminToken: string;

  beforeAll(() => {
    process.env.ADMIN_STELLAR_PUBKEYS = adminAddress;
    adminToken = signToken(adminAddress);
  });

  beforeEach(() => {
    delete process.env.ADMIN_ROUTES_ENABLED;
    (env as unknown as { ADMIN_ROUTES_ENABLED: boolean }).ADMIN_ROUTES_ENABLED = false;
  });

  afterEach(() => {
    process.env.ADMIN_ROUTES_ENABLED = "true";
    (env as unknown as { ADMIN_ROUTES_ENABLED: boolean }).ADMIN_ROUTES_ENABLED = true;
  });

  it("returns 404 for admin features when ADMIN_ROUTES_ENABLED is not set", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/api/admin/features")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
    expect(res.body.message).toMatch(/admin routes are not enabled/i);
  });

  it("returns 404 for admin features when ADMIN_ROUTES_ENABLED is false", async () => {
    process.env.ADMIN_ROUTES_ENABLED = "false";
    const app = buildApp();
    const res = await request(app)
      .get("/api/admin/features")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it("allows admin features when ADMIN_ROUTES_ENABLED is true", async () => {
    process.env.ADMIN_ROUTES_ENABLED = "true";
    const app = buildApp();
    const res = await request(app)
      .get("/api/admin/features")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("returns 404 for admin auth claims when disabled", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/api/admin/auth/claims")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it("allows admin auth claims when enabled", async () => {
    process.env.ADMIN_ROUTES_ENABLED = "true";
    const app = buildApp();
    const res = await request(app)
      .get("/api/admin/auth/claims")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("returns 404 for admin stream clawback when disabled", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/admin/streams/stream-1/clawback/preview")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "100" });
    expect(res.status).toBe(404);
  });

  it("defaults to disabled (safe state)", async () => {
    delete process.env.ADMIN_ROUTES_ENABLED;
    const app = buildApp();
    const res = await request(app)
      .get("/api/admin/features")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

import express, { Express } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";

import { createAdminContractRouter } from "../routes/admin.contract.routes";
import { createAdminFeaturesRouter } from "../routes/admin.features.routes";
import { createAdminStreamsRouter } from "../routes/admin.streams.routes";
import { errorHandler } from "../middleware/errorHandler";
import { correlationIdMiddleware } from "../middleware/correlationId.middleware";
import { ContractService } from "../services/contract.service";
import { AppError, ErrorCode } from "../errors/errorCodes";

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

jest.mock("../middleware/adminQuota.middleware", () => ({
  createAdminQuotaMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const mockContractService = {
  buildAddMediatorTx: jest.fn(),
  buildRemoveMediatorTx: jest.fn(),
  buildUpdateFeeBpsTx: jest.fn(),
};
const contractService = mockContractService as unknown as ContractService;

const adminAddress = StellarSdk.Keypair.random().publicKey();
const outsiderAddress = StellarSdk.Keypair.random().publicKey();

function signToken(walletAddress: string): string {
  const secret = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { walletAddress, jti: "error-std-test", iss: "amana", aud: "amana-api", nbf: now - 1 },
    secret,
    { algorithm: "HS256" },
  );
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(correlationIdMiddleware);
  app.use("/", createAdminContractRouter(contractService));
  app.use("/", createAdminFeaturesRouter());
  app.use("/api", createAdminStreamsRouter());
  app.use(errorHandler);
  return app;
}

function assertStandardErrorShape(body: Record<string, unknown>) {
  expect(body).toHaveProperty("code");
  expect(body).toHaveProperty("message");
  expect(body).toHaveProperty("details");
  expect(body).toHaveProperty("timestamp");
  expect(typeof body.code).toBe("string");
  expect(typeof body.message).toBe("string");
}

describe("admin error response standardization (#12)", () => {
  let app: Express;
  let adminToken: string;
  let outsiderToken: string;

  beforeAll(() => {
    process.env.ADMIN_STELLAR_PUBKEYS = adminAddress;
    adminToken = signToken(adminAddress);
    outsiderToken = signToken(outsiderAddress);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe("400 validation errors follow {code, message, details}", () => {
    it("returns standardized error for missing required field", async () => {
      const res = await request(app)
        .post("/api/admin/contract/mediators")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
      assertStandardErrorShape(res.body);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("returns standardized error for invalid field type", async () => {
      const res = await request(app)
        .patch("/api/admin/contract/fee")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ feeBps: "not-a-number" });

      expect(res.status).toBe(400);
      assertStandardErrorShape(res.body);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it("returns standardized error for out-of-range value", async () => {
      const res = await request(app)
        .patch("/api/admin/contract/fee")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ feeBps: 9999 });

      expect(res.status).toBe(400);
      assertStandardErrorShape(res.body);
    });

    it("returns standardized error for invalid stream clawback amount", async () => {
      const res = await request(app)
        .post("/api/admin/streams/stream-1/clawback/preview")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ amount: "abc" });

      expect(res.status).toBe(400);
      assertStandardErrorShape(res.body);
    });
  });

  describe("403 forbidden errors follow {code, message, details}", () => {
    it("returns standardized error for non-admin user", async () => {
      const res = await request(app)
        .get("/api/admin/features")
        .set("Authorization", `Bearer ${outsiderToken}`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Forbidden: admin access required" });
    });

    it("does not leak the admin allowlist in the error body", async () => {
      const res = await request(app)
        .get("/api/admin/features")
        .set("Authorization", `Bearer ${outsiderToken}`);

      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(adminAddress);
    });
  });

  describe("500 internal errors follow {code, message, details}", () => {
    it("returns standardized error on unhandled service failure", async () => {
      mockContractService.buildAddMediatorTx.mockRejectedValue(
        new AppError(ErrorCode.INTERNAL_ERROR, "Unexpected service failure", 500),
      );

      const res = await request(app)
        .post("/api/admin/contract/mediators")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ mediatorAddress: StellarSdk.Keypair.random().publicKey() });

      expect(res.status).toBe(500);
      assertStandardErrorShape(res.body);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });
  });
});

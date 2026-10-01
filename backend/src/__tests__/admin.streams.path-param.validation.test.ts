/**
 * Admin stream path parameter validation (#38).
 *
 * Validates that admin stream route params (:id) are validated at the route
 * level with correct format constraints. Invalid IDs return 400 with a
 * standardized error shape before any service invocation.
 */

jest.mock("../config/env", () => ({
  env: { NODE_ENV: "test", JWT_SECRET: "test-jwt-secret-value-with-minimum-length-32" },
  runtimeEnvValue: (key: string) => process.env[key] ?? false,
}));

jest.mock("../config/rateLimit", () => ({
  RATE_LIMIT_CONFIG: {
    admin: { windowMs: 60_000, max: 1_000, message: "Too many admin requests" },
  },
}));

jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      const jsonwebtoken = require("jsonwebtoken");
      return jsonwebtoken.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

const mockIsMediatorAddress = jest.fn();
jest.mock("../lib/accessControl", () => ({
  isMediatorAddress: (address: string) => mockIsMediatorAddress(address),
}));

jest.mock("../middleware/adminQuota.middleware", () => ({
  createAdminQuotaMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock("../services/feature-flags.service", () => ({
  featureFlagService: {
    listFlags: jest.fn().mockResolvedValue([]),
    setFlag: jest.fn().mockResolvedValue({ name: "beta", enabled: true }),
  },
}));

import express, { Express } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";

import { createAdminStreamsRouter } from "../routes/admin.streams.routes";
import { createAdminFeaturesRouter } from "../routes/admin.features.routes";
import { StreamTerminationService } from "../services/streamTermination.service";
import { AdminStreamsService } from "../services/adminStreams.service";
import { errorHandler } from "../middleware/errorHandler";

const JWT_SECRET = "test-jwt-secret-value-with-minimum-length-32";
const ADMIN_ADDRESS = "GADMIN000000000000000000000000000000000000000000000000";
const mockPrisma = {
  adminActionAudit: { create: jest.fn().mockResolvedValue({}) },
};

function tokenFor(walletAddress: string): string {
  return jwt.sign({ walletAddress, tokenId: "test-token-id" }, JWT_SECRET, { expiresIn: "1h" });
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAdminStreamsRouter(new StreamTerminationService({} as never), undefined, {} as never),
  );
  app.use("/", createAdminFeaturesRouter(mockPrisma as never));
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

describe("Admin stream path parameter validation (#38)", () => {
  let app: Express;
  let adminToken: string;

  beforeAll(() => {
    process.env.ADMIN_STELLAR_PUBKEYS = ADMIN_ADDRESS;
    adminToken = tokenFor(ADMIN_ADDRESS);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsMediatorAddress.mockImplementation((address: string) => address === ADMIN_ADDRESS);
    app = buildApp();
  });

  const STREAM_ROUTES = [
    { method: "get" as const, path: "/api/admin/streams/:id", suffix: "" },
    { method: "post" as const, path: "/api/admin/streams/:id/clawback/preview", suffix: "/clawback/preview" },
    { method: "post" as const, path: "/api/admin/streams/:id/suspend", suffix: "/suspend" },
    { method: "post" as const, path: "/api/admin/streams/:id/resume", suffix: "/resume" },
    { method: "post" as const, path: "/api/admin/streams/:id/terminate", suffix: "/terminate" },
    { method: "post" as const, path: "/api/admin/streams/:id/lock", suffix: "/lock" },
    { method: "post" as const, path: "/api/admin/streams/:id/unlock", suffix: "/unlock" },
  ];

  describe("invalid stream IDs return 400", () => {
    it.each([
      ["contains spaces", "stream 123"],
      ["contains special characters", "stream@123"],
      ["contains slashes", "stream/123"],
      ["contains backslashes", "stream\\123"],
      ["contains dots", "stream.123"],
      ["too long (129 chars)", "a".repeat(129)],
    ])("rejects %s as stream ID on GET /api/admin/streams/:id", async (_label, id) => {
      const res = await request(app)
        .get(`/api/admin/streams/${encodeURIComponent(id)}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      assertStandardErrorShape(res.body);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });

    it.each([
      ["contains spaces", "stream 123"],
      ["contains special characters", "stream@123"],
      ["too long (129 chars)", "a".repeat(129)],
    ])("rejects %s as stream ID on POST /api/admin/streams/:id/lock", async (_label, id) => {
      const res = await request(app)
        .post(`/api/admin/streams/${encodeURIComponent(id)}/lock`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
      assertStandardErrorShape(res.body);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("error shape for invalid IDs", () => {
    it("returns field-level error details for invalid stream ID", async () => {
      const res = await request(app)
        .get("/api/admin/streams/invalid id with spaces")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.details).toBeDefined();
      expect(Array.isArray(res.body.details.errors)).toBe(true);
      expect(res.body.details.errors[0]).toHaveProperty("path", "id");
      expect(res.body.details.errors[0]).toHaveProperty("message");
    });

    it("does not invoke any service for invalid stream IDs", async () => {
      const getCachedStreamState = jest.fn();
      jest.mock("../services/streamCache.service", () => ({
        getCachedStreamState: (...args: unknown[]) => getCachedStreamState(...args),
      }));

      const res = await request(app)
        .get("/api/admin/streams/invalid!")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(getCachedStreamState).not.toHaveBeenCalled();
    });
  });
});

describe("Admin feature flag path parameter validation (#38)", () => {
  let app: Express;
  let adminToken: string;

  beforeAll(() => {
    process.env.ADMIN_STELLAR_PUBKEYS = ADMIN_ADDRESS;
    adminToken = tokenFor(ADMIN_ADDRESS);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsMediatorAddress.mockImplementation((address: string) => address === ADMIN_ADDRESS);
    app = buildApp();
  });

  describe("invalid feature names return 400", () => {
    it("rejects a feature name with spaces", async () => {
      const res = await request(app)
        .patch("/api/admin/features/beta feature")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ enabled: true });

      expect(res.status).toBe(400);
      assertStandardErrorShape(res.body);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("valid feature names are accepted", () => {
    it("accepts a valid feature name (no validation error)", async () => {
      const res = await request(app)
        .patch("/api/admin/features/beta")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ enabled: true });

      // Should NOT be a 400 validation error (may succeed or fail at service level)
      expect(res.status).not.toBe(400);
    });
  });
});

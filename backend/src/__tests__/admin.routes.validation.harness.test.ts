/**
 * Admin route validation harness (#23).
 *
 * A focused unit harness for admin route input validation and auth failure
 * modes. Every route handler is isolated behind mocked services and a mocked
 * AuthService, so nothing here touches Prisma, Soroban RPC or the real app
 * wiring — a failure points at the route's guards, not at infrastructure.
 *
 * Covered:
 *   - missing / malformed / non-admin auth on every admin router
 *   - malformed payloads: wrong types, missing fields, out-of-range values,
 *     oversized batches, unparseable JSON
 *   - invalid resource identifiers (Stellar addresses, trade IDs, feature names)
 *   - asserted status codes and error message bodies
 *
 * Note on "invalid stream IDs" in the issue: this service has no stream
 * resource. The equivalent identifiers on admin routes are Stellar addresses
 * (mediator management) and trade IDs (batch status), so those are what the
 * identifier cases below exercise.
 */

import express, { Express } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { TradeStatus } from "@prisma/client";

import { createAdminContractRouter } from "../routes/admin.contract.routes";
import { createAdminTradeBatchRouter } from "../routes/admin.trades.batch.routes";
import { createAdminFeaturesRouter } from "../routes/admin.features.routes";
import { createAdminAuditRouter } from "../routes/admin.audit.routes";
import { createAdminAuthRouter } from "../routes/admin.auth.routes";
import { errorHandler } from "../middleware/errorHandler";
import { correlationIdMiddleware } from "../middleware/correlationId.middleware";
import { AuthService } from "../services/auth.service";
import { ContractService } from "../services/contract.service";

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
    listFlags: jest.fn().mockResolvedValue([]),
    setFlag: jest.fn().mockResolvedValue({ enabled: true }),
  },
}));

jest.mock("../services/adminAudit.service", () => ({
  adminAuditService: {
    list: jest.fn().mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 }),
  },
}));

jest.mock("../middleware/adminQuota.middleware", () => ({
  createAdminQuotaMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

type MockedContractService = ContractService & {
  buildAddMediatorTx: jest.Mock;
  buildRemoveMediatorTx: jest.Mock;
  buildUpdateFeeBpsTx: jest.Mock;
};

const contractService = {
  buildAddMediatorTx: jest.fn(),
  buildRemoveMediatorTx: jest.fn(),
  buildUpdateFeeBpsTx: jest.fn(),
} as unknown as MockedContractService;

const prisma = {
  trade: {
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
};

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(correlationIdMiddleware);
  app.use("/", createAdminContractRouter(contractService));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use("/", createAdminTradeBatchRouter(prisma as any));
  app.use("/", createAdminFeaturesRouter());
  app.use("/", createAdminAuditRouter());
  app.use("/", createAdminAuthRouter());
  app.use(errorHandler);
  return app;
}

const adminAddress = StellarSdk.Keypair.random().publicKey();
const outsiderAddress = StellarSdk.Keypair.random().publicKey();
const mediatorAddress = StellarSdk.Keypair.random().publicKey();

function signToken(walletAddress: string, jti: string): string {
  const secret = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
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

/** Every admin endpoint, so the auth matrix below stays exhaustive. */
const ADMIN_ENDPOINTS: Array<{
  name: string;
  method: "get" | "post" | "patch" | "delete";
  path: string;
  body?: object;
}> = [
  {
    name: "add mediator",
    method: "post",
    path: "/admin/contract/mediators",
    body: { mediatorAddress },
  },
  {
    name: "remove mediator",
    method: "delete",
    path: `/admin/contract/mediators/${mediatorAddress}`,
  },
  { name: "update fee", method: "patch", path: "/admin/contract/fee", body: { feeBps: 100 } },
  {
    name: "batch trade status",
    method: "post",
    path: "/admin/trades/batch/status",
    body: { updates: [{ tradeId: "t-1", status: TradeStatus.CREATED }] },
  },
  { name: "list features", method: "get", path: "/admin/features" },
  {
    name: "update feature",
    method: "patch",
    path: "/admin/features/beta",
    body: { enabled: true },
  },
  { name: "list audit", method: "get", path: "/admin/audit" },
  { name: "auth claims", method: "get", path: "/api/admin/auth/claims" },
];

describe("admin route validation harness (#23)", () => {
  let app: Express;
  let adminToken: string;
  let outsiderToken: string;

  beforeAll(() => {
    process.env.ADMIN_STELLAR_PUBKEYS = adminAddress;
    adminToken = signToken(adminAddress, "harness-admin");
    outsiderToken = signToken(outsiderAddress, "harness-outsider");
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
    app = buildApp();
  });

  // ── Auth failure modes ────────────────────────────────────────────────────
  describe("missing auth", () => {
    it.each(ADMIN_ENDPOINTS)("$name returns 401 with no Authorization header", async (route) => {
      const res = await request(app)[route.method](route.path).send(route.body);
      expect(res.status).toBe(401);
    });

    it.each(ADMIN_ENDPOINTS)("$name returns 401 for a malformed bearer token", async (route) => {
      const res = await request(app)[route.method](route.path)
        .set("Authorization", "Bearer not-a-jwt")
        .send(route.body);
      expect(res.status).toBe(401);
    });

    it("returns 401 when the scheme is not Bearer", async () => {
      const res = await request(app)
        .get("/admin/features")
        .set("Authorization", `Basic ${adminToken}`);
      expect(res.status).toBe(401);
    });

    it("returns 401 when the Authorization header is empty", async () => {
      const res = await request(app).get("/admin/features").set("Authorization", "");
      expect(res.status).toBe(401);
    });
  });

  describe("non-admin auth", () => {
    it.each(ADMIN_ENDPOINTS)("$name returns 403 for an authenticated outsider", async (route) => {
      const res = await request(app)[route.method](route.path)
        .set("Authorization", `Bearer ${outsiderToken}`)
        .send(route.body);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/admin access required/i);
      expect(res.body.code).toBe("AUTH_ERROR");
    });

    it("does not reach any service when authorization fails", async () => {
      await request(app)
        .post("/admin/contract/mediators")
        .set("Authorization", `Bearer ${outsiderToken}`)
        .send({ mediatorAddress });

      expect(contractService.buildAddMediatorTx).not.toHaveBeenCalled();
      expect(prisma.trade.findFirst).not.toHaveBeenCalled();
    });
  });

  // ── Malformed payloads ────────────────────────────────────────────────────
  describe("malformed payloads", () => {
    function asAdmin(method: "post" | "patch", path: string) {
      return request(app)[method](path).set("Authorization", `Bearer ${adminToken}`);
    }

    it("rejects a body that is not an object", async () => {
      const res = await asAdmin("post", "/admin/contract/mediators")
        .set("Content-Type", "application/json")
        .send('"just-a-string"');
      expect(res.status).toBe(400);
      expect(contractService.buildAddMediatorTx).not.toHaveBeenCalled();
    });

    it("rejects unparseable JSON", async () => {
      const res = await asAdmin("post", "/admin/contract/mediators")
        .set("Content-Type", "application/json")
        .send("{ not json");
      expect(res.status).toBe(400);
      expect(contractService.buildAddMediatorTx).not.toHaveBeenCalled();
    });

    it("rejects a missing required field with a field-named message", async () => {
      const res = await asAdmin("post", "/admin/contract/mediators").send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toContain("mediatorAddress");
    });

    it("rejects a wrong-typed field", async () => {
      const res = await asAdmin("patch", "/admin/contract/fee").send({ feeBps: "100" });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain("feeBps");
      expect(contractService.buildUpdateFeeBpsTx).not.toHaveBeenCalled();
    });

    it.each([
      ["below the minimum", 0],
      ["above the maximum", 501],
      ["negative", -1],
      ["fractional", 12.5],
    ])("rejects feeBps %s", async (_label, feeBps) => {
      const res = await asAdmin("patch", "/admin/contract/fee").send({ feeBps });
      expect(res.status).toBe(400);
      expect(contractService.buildUpdateFeeBpsTx).not.toHaveBeenCalled();
    });

    it("accepts feeBps at both range boundaries", async () => {
      contractService.buildUpdateFeeBpsTx.mockResolvedValue({ unsignedXdr: "xdr" });

      for (const feeBps of [1, 500]) {
        const res = await asAdmin("patch", "/admin/contract/fee").send({ feeBps });
        expect(res.status).toBe(200);
      }
      expect(contractService.buildUpdateFeeBpsTx).toHaveBeenCalledTimes(2);
    });

    it("rejects a feature flag update with a non-boolean enabled", async () => {
      const res = await asAdmin("patch", "/admin/features/beta").send({ enabled: "yes" });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain("enabled");
    });

    it("rejects a rolloutPercentage outside 0-100", async () => {
      const res = await asAdmin("patch", "/admin/features/beta").send({
        enabled: true,
        rolloutPercentage: 150,
      });
      expect(res.status).toBe(400);
    });

    it("rejects an empty batch of trade updates", async () => {
      const res = await asAdmin("post", "/admin/trades/batch/status").send({ updates: [] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/at least one update/i);
      expect(prisma.trade.findFirst).not.toHaveBeenCalled();
    });

    it("rejects a batch larger than the 100-update cap", async () => {
      const updates = Array.from({ length: 101 }, (_, i) => ({
        tradeId: `t-${i}`,
        status: TradeStatus.CREATED,
      }));
      const res = await asAdmin("post", "/admin/trades/batch/status").send({ updates });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/maximum 100/i);
      expect(prisma.trade.findFirst).not.toHaveBeenCalled();
    });

    it("rejects a batch where updates is not an array", async () => {
      const res = await asAdmin("post", "/admin/trades/batch/status").send({ updates: "all" });
      expect(res.status).toBe(400);
      expect(prisma.trade.findFirst).not.toHaveBeenCalled();
    });
  });

  // ── Invalid resource identifiers ──────────────────────────────────────────
  describe("invalid resource identifiers", () => {
    function asAdmin(method: "post" | "delete", path: string) {
      return request(app)[method](path).set("Authorization", `Bearer ${adminToken}`);
    }

    it.each([
      ["not a Stellar key", "not-a-valid-address"],
      ["a contract address", "CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ"],
      ["a secret seed", StellarSdk.Keypair.random().secret()],
      ["truncated", mediatorAddress.slice(0, 20)],
      ["empty", " "],
    ])("rejects add-mediator when the address is %s", async (_label, address) => {
      const res = await asAdmin("post", "/admin/contract/mediators").send({
        mediatorAddress: address,
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/valid Stellar public key/i);
      expect(contractService.buildAddMediatorTx).not.toHaveBeenCalled();
    });

    it("rejects remove-mediator for a malformed address param", async () => {
      const res = await asAdmin("delete", "/admin/contract/mediators/not-a-valid-address");
      expect(res.status).toBe(400);
      expect(contractService.buildRemoveMediatorTx).not.toHaveBeenCalled();
    });

    it("rejects a batch entry with an empty tradeId", async () => {
      const res = await asAdmin("post", "/admin/trades/batch/status").send({
        updates: [{ tradeId: "", status: TradeStatus.CREATED }],
      });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/tradeId/i);
      expect(prisma.trade.findFirst).not.toHaveBeenCalled();
    });

    it("rejects a batch entry with an unknown status", async () => {
      const res = await asAdmin("post", "/admin/trades/batch/status").send({
        updates: [{ tradeId: "t-1", status: "NOT_A_STATUS" }],
      });
      expect(res.status).toBe(400);
      expect(prisma.trade.findFirst).not.toHaveBeenCalled();
    });

    it("reports an unknown tradeId as a per-entry failure, not a 400", async () => {
      prisma.trade.findFirst.mockResolvedValue(null);

      const res = await asAdmin("post", "/admin/trades/batch/status").send({
        updates: [{ tradeId: "missing", status: TradeStatus.CREATED }],
      });

      expect(res.status).toBe(200);
      expect(res.body.failed).toEqual([{ tradeId: "missing", reason: "Trade not found" }]);
      expect(res.body.succeeded).toEqual([]);
    });

    it("reports an illegal status transition as a per-entry failure", async () => {
      prisma.trade.findFirst.mockResolvedValue({
        tradeId: "t-1",
        status: TradeStatus.COMPLETED,
        version: 1,
      });

      const res = await asAdmin("post", "/admin/trades/batch/status").send({
        updates: [{ tradeId: "t-1", status: TradeStatus.FUNDED }],
      });

      expect(res.status).toBe(200);
      expect(res.body.failed[0].reason).toMatch(/Invalid transition from COMPLETED to FUNDED/);
      expect(prisma.trade.updateMany).not.toHaveBeenCalled();
    });
  });

  // ── Error surface ─────────────────────────────────────────────────────────
  describe("error responses", () => {
    it("maps a service failure to 500 through the error handler", async () => {
      contractService.buildAddMediatorTx.mockRejectedValue(new Error("RPC unreachable"));

      const res = await request(app)
        .post("/admin/contract/mediators")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ mediatorAddress });

      expect(res.status).toBe(500);
      expect(res.body.code).toBe("INTERNAL_ERROR");
    });

    it("carries tracing headers on validation failures too", async () => {
      const res = await request(app)
        .patch("/admin/contract/fee")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ feeBps: 9999 });

      expect(res.status).toBe(400);
      expect(res.headers["x-request-id"]).toBeDefined();
      expect(res.headers["x-correlation-id"]).toBeDefined();
    });

    it("never leaks the admin allowlist in a 403 body", async () => {
      const res = await request(app)
        .get("/admin/features")
        .set("Authorization", `Bearer ${outsiderToken}`);

      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(adminAddress);
    });
  });
});

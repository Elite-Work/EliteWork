/**
 * Admin request correlation IDs (#21).
 *
 * Verifies that the IDs attached by `correlationIdMiddleware` reach the admin
 * route handler, are handed to the service layer, and travel into the Soroban
 * submission path — so one admin action can be followed end to end.
 */

import express, { Express } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";

import { createAdminContractRouter } from "../routes/admin.contract.routes";
import { errorHandler } from "../middleware/errorHandler";
import {
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
  correlationIdMiddleware,
  traceContextFrom,
} from "../middleware/correlationId.middleware";
import { AuthService } from "../services/auth.service";
import { ContractService } from "../services/contract.service";
import { AppError, ErrorCode } from "../errors/errorCodes";

jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const jsonwebtoken = require("jsonwebtoken");
      return jsonwebtoken.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

type MockedContractService = ContractService & {
  buildAddMediatorTx: jest.Mock;
  buildRemoveMediatorTx: jest.Mock;
  buildUpdateFeeBpsTx: jest.Mock;
};

const contractService = {
  buildAddMediatorTx: jest.fn().mockResolvedValue({ unsignedXdr: "xdr" }),
  buildRemoveMediatorTx: jest.fn().mockResolvedValue({ unsignedXdr: "xdr" }),
  buildUpdateFeeBpsTx: jest.fn().mockResolvedValue({ unsignedXdr: "xdr" }),
} as unknown as MockedContractService;

const prisma = {
  adminActionAudit: {
    create: jest.fn().mockResolvedValue({}),
  },
};

const adminAddress = StellarSdk.Keypair.random().publicKey();
const mediatorAddress = StellarSdk.Keypair.random().publicKey();

function signToken(walletAddress: string, jti: string): string {
  const secret = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
  return jwt.sign(
    {
      walletAddress,
      jti,
      iss: process.env.JWT_ISSUER,
      aud: process.env.JWT_AUDIENCE,
      nbf: Math.floor(Date.now() / 1000) - 1,
    },
    secret,
    { algorithm: "HS256" },
  );
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(correlationIdMiddleware);
  app.use("/", createAdminContractRouter(contractService, prisma as never));
  app.use(errorHandler);
  return app;
}

describe("admin request correlation IDs (#21)", () => {
  let app: Express;
  let adminToken: string;

  beforeAll(() => {
    process.env.ADMIN_STELLAR_PUBKEYS = adminAddress;
    adminToken = signToken(adminAddress, "correlation-admin");
  });

  beforeEach(() => {
    jest.clearAllMocks();
    contractService.buildAddMediatorTx.mockResolvedValue({ unsignedXdr: "xdr" });
    contractService.buildRemoveMediatorTx.mockResolvedValue({ unsignedXdr: "xdr" });
    contractService.buildUpdateFeeBpsTx.mockResolvedValue({ unsignedXdr: "xdr" });
    app = buildApp();
  });

  describe("every admin request receives an ID", () => {
    it("echoes both a correlation ID and a request ID", async () => {
      const res = await request(app)
        .post("/api/admin/contract/mediators")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ mediatorAddress });

      expect(res.status).toBe(200);
      expect(res.headers[CORRELATION_ID_HEADER]).toMatch(/^[\w-]+$/);
      expect(res.headers[REQUEST_ID_HEADER]).toMatch(/^[\w-]+$/);
    });

    it("generates a fresh request ID per request", async () => {
      const first = await request(app)
        .patch("/api/admin/contract/fee")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ feeBps: 100 });
      const second = await request(app)
        .patch("/api/admin/contract/fee")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ feeBps: 100 });

      expect(first.headers[REQUEST_ID_HEADER]).not.toBe(second.headers[REQUEST_ID_HEADER]);
    });

    it("propagates a caller-supplied correlation ID across the hop", async () => {
      const res = await request(app)
        .post("/api/admin/contract/mediators")
        .set("Authorization", `Bearer ${adminToken}`)
        .set(CORRELATION_ID_HEADER, "upstream-trace-1")
        .send({ mediatorAddress });

      expect(res.headers[CORRELATION_ID_HEADER]).toBe("upstream-trace-1");
    });

    it("never trusts a caller-supplied request ID", async () => {
      const res = await request(app)
        .post("/api/admin/contract/mediators")
        .set("Authorization", `Bearer ${adminToken}`)
        .set(REQUEST_ID_HEADER, "forged-request-id")
        .send({ mediatorAddress });

      expect(res.headers[REQUEST_ID_HEADER]).not.toBe("forged-request-id");
    });

    it.each([
      ["contains unsafe characters", "trace; drop table"],
      ["exceeds the length cap", "a".repeat(129)],
    ])("replaces a correlation ID that %s", async (_label, supplied) => {
      const res = await request(app)
        .post("/api/admin/contract/mediators")
        .set("Authorization", `Bearer ${adminToken}`)
        .set(CORRELATION_ID_HEADER, supplied)
        .send({ mediatorAddress });

      expect(res.headers[CORRELATION_ID_HEADER]).not.toBe(supplied);
      expect(res.headers[CORRELATION_ID_HEADER]).toMatch(/^[\w-]+$/);
    });
  });

  describe("IDs reach the service layer", () => {
    it("passes the trace context into buildAddMediatorTx", async () => {
      const res = await request(app)
        .post("/api/admin/contract/mediators")
        .set("Authorization", `Bearer ${adminToken}`)
        .set(CORRELATION_ID_HEADER, "trace-add")
        .send({ mediatorAddress });

      expect(contractService.buildAddMediatorTx).toHaveBeenCalledWith(
        expect.objectContaining({
          adminAddress,
          mediatorAddress,
          trace: {
            correlationId: "trace-add",
            requestId: res.headers[REQUEST_ID_HEADER],
          },
        }),
      );
    });

    it("passes the trace context into buildRemoveMediatorTx", async () => {
      const res = await request(app)
        .delete(`/api/admin/contract/mediators/${mediatorAddress}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set(CORRELATION_ID_HEADER, "trace-remove");

      expect(contractService.buildRemoveMediatorTx).toHaveBeenCalledWith(
        expect.objectContaining({
          trace: {
            correlationId: "trace-remove",
            requestId: res.headers[REQUEST_ID_HEADER],
          },
        }),
      );
    });

    it("passes the trace context into buildUpdateFeeBpsTx", async () => {
      const res = await request(app)
        .patch("/api/admin/contract/fee")
        .set("Authorization", `Bearer ${adminToken}`)
        .set(CORRELATION_ID_HEADER, "trace-fee")
        .send({ feeBps: 250 });

      expect(contractService.buildUpdateFeeBpsTx).toHaveBeenCalledWith(
        expect.objectContaining({
          feeBps: 250,
          trace: {
            correlationId: "trace-fee",
            requestId: res.headers[REQUEST_ID_HEADER],
          },
        }),
      );
    });

    it("gives the service the same request ID the caller sees", async () => {
      const res = await request(app)
        .patch("/api/admin/contract/fee")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ feeBps: 100 });

      const call = contractService.buildUpdateFeeBpsTx.mock.calls[0][0];
      expect(call.trace.requestId).toBe(res.headers[REQUEST_ID_HEADER]);
      expect(call.trace.correlationId).toBe(res.headers[CORRELATION_ID_HEADER]);
    });
  });

  describe("error responses carry the IDs", () => {
    it("includes both IDs in the body when a service call fails", async () => {
      contractService.buildAddMediatorTx.mockRejectedValue(
        new AppError(ErrorCode.INTERNAL_ERROR, "service unavailable", 500),
      );

      const res = await request(app)
        .post("/api/admin/contract/mediators")
        .set("Authorization", `Bearer ${adminToken}`)
        .set(CORRELATION_ID_HEADER, "trace-error")
        .send({ mediatorAddress });

      expect(res.status).toBe(500);
      expect(res.body.correlationId).toBe("trace-error");
      expect(res.body.requestId).toBe(res.headers[REQUEST_ID_HEADER]);
    });

    it("still returns the IDs as headers on a validation failure", async () => {
      const res = await request(app)
        .patch("/api/admin/contract/fee")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ feeBps: 9999 });

      expect(res.status).toBe(400);
      expect(res.headers[CORRELATION_ID_HEADER]).toBeDefined();
      expect(res.headers[REQUEST_ID_HEADER]).toBeDefined();
    });
  });

  describe("traceContextFrom", () => {
    it("returns undefined fields for a request with no tracing applied", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const trace = traceContextFrom({ headers: {} } as any);
      expect(trace).toEqual({ correlationId: undefined, requestId: undefined });
    });

    it("falls back to the x-request-id header when the middleware did not run", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const trace = traceContextFrom({ headers: { [REQUEST_ID_HEADER]: "abc-123" } } as any);
      expect(trace.requestId).toBe("abc-123");
    });

    it("ignores an unsafe fallback header value", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const trace = traceContextFrom({ headers: { [REQUEST_ID_HEADER]: "bad value!" } } as any);
      expect(trace.requestId).toBeUndefined();
    });
  });
});

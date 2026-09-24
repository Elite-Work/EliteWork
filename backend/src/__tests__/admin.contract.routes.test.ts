import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createAdminContractRouter } from "../routes/admin.contract.routes";
import { AuthService } from "../services/auth.service";
import { errorHandler } from "../middleware/errorHandler";
import { ContractService } from "../services/contract.service";
import { correlationIdMiddleware } from "../middleware/correlationId.middleware";

jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      const jwt = require("jsonwebtoken");
      return jwt.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

const mockContractService = {
  buildAddMediatorTx: jest.fn(),
  buildRemoveMediatorTx: jest.fn(),
  buildUpdateFeeBpsTx: jest.fn(),
} as unknown as ContractService & {
  buildAddMediatorTx: jest.Mock;
  buildRemoveMediatorTx: jest.Mock;
  buildUpdateFeeBpsTx: jest.Mock;
};

const mockPrisma = {
  adminActionAudit: { create: jest.fn().mockResolvedValue({}) },
};

const app = express();
app.use(express.json());
app.use(correlationIdMiddleware);
app.use("/", createAdminContractRouter(mockContractService, mockPrisma as never));
app.use(errorHandler);

const timeoutApp = express();
timeoutApp.use(express.json());
timeoutApp.use("/", createAdminContractRouter(mockContractService, mockPrisma as never, 30));
timeoutApp.use(errorHandler);

describe("Admin Contract Maintenance Routes", () => {
  const adminAddress = StellarSdk.Keypair.random().publicKey();
  const nonAdminAddress = StellarSdk.Keypair.random().publicKey();
  const mediatorAddress = StellarSdk.Keypair.random().publicKey();
  let adminToken: string;
  let nonAdminToken: string;

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

  beforeAll(() => {
    process.env.ADMIN_STELLAR_PUBKEYS = adminAddress;
    adminToken = signToken(adminAddress, "contract-admin-jti");
    nonAdminToken = signToken(nonAdminAddress, "contract-nonadmin-jti");
  });

  beforeEach(() => {
    jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
    jest.clearAllMocks();
  });

  describe("authorization", () => {
    it("rejects add-mediator with 401 when unauthenticated", async () => {
      const res = await request(app)
        .post("/api/admin/contract/mediators")
        .send({ mediatorAddress });
      expect(res.status).toBe(401);
      expect(mockContractService.buildAddMediatorTx).not.toHaveBeenCalled();
    });

    it("rejects add-mediator with 403 for a non-admin wallet", async () => {
      const res = await request(app)
        .post("/api/admin/contract/mediators")
        .set("Authorization", `Bearer ${nonAdminToken}`)
        .send({ mediatorAddress });
      expect(res.status).toBe(403);
      expect(mockContractService.buildAddMediatorTx).not.toHaveBeenCalled();
    });

    it("rejects remove-mediator with 403 for a non-admin wallet", async () => {
      const res = await request(app)
        .delete(`/api/admin/contract/mediators/${mediatorAddress}`)
        .set("Authorization", `Bearer ${nonAdminToken}`);
      expect(res.status).toBe(403);
      expect(mockContractService.buildRemoveMediatorTx).not.toHaveBeenCalled();
    });

    it("rejects fee update with 403 for a non-admin wallet", async () => {
      const res = await request(app)
        .patch("/api/admin/contract/fee")
        .set("Authorization", `Bearer ${nonAdminToken}`)
        .send({ feeBps: 100 });
      expect(res.status).toBe(403);
      expect(mockContractService.buildUpdateFeeBpsTx).not.toHaveBeenCalled();
    });
  });

  describe("request validation", () => {
    it("rejects add-mediator with 400 for a malformed mediator address", async () => {
      const res = await request(app)
        .post("/api/admin/contract/mediators")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ mediatorAddress: "not-a-valid-address" });
      expect(res.status).toBe(400);
      expect(mockContractService.buildAddMediatorTx).not.toHaveBeenCalled();
    });

    it("rejects add-mediator with 400 when mediatorAddress is missing", async () => {
      const res = await request(app)
        .post("/api/admin/contract/mediators")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});
      expect(res.status).toBe(400);
      expect(mockContractService.buildAddMediatorTx).not.toHaveBeenCalled();
    });

    it("rejects remove-mediator with 400 for a malformed address param", async () => {
      const res = await request(app)
        .delete("/api/admin/contract/mediators/not-a-valid-address")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
      expect(mockContractService.buildRemoveMediatorTx).not.toHaveBeenCalled();
    });

    it("rejects fee update with 400 when feeBps is out of range", async () => {
      const res = await request(app)
        .patch("/api/admin/contract/fee")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ feeBps: 5000 });
      expect(res.status).toBe(400);
      expect(mockContractService.buildUpdateFeeBpsTx).not.toHaveBeenCalled();
    });

    it("rejects fee update with 400 when feeBps is not an integer", async () => {
      const res = await request(app)
        .patch("/api/admin/contract/fee")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ feeBps: 12.5 });
      expect(res.status).toBe(400);
      expect(mockContractService.buildUpdateFeeBpsTx).not.toHaveBeenCalled();
    });
  });

  describe("happy path", () => {
    it("builds an unsigned add-mediator transaction for an admin caller", async () => {
      mockContractService.buildAddMediatorTx.mockResolvedValue({ unsignedXdr: "unsigned-add" });

      const res = await request(app)
        .post("/api/admin/contract/mediators")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ mediatorAddress });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ unsignedXdr: "unsigned-add" });
      expect(mockContractService.buildAddMediatorTx).toHaveBeenCalledWith({
        adminAddress,
        mediatorAddress,
        trace: expect.objectContaining({ requestId: expect.any(String) }),
      });
      expect(mockPrisma.adminActionAudit.create).toHaveBeenCalledWith({
        data: { action: "ADD_MEDIATOR", actorAddress: adminAddress, targetReference: mediatorAddress },
      });
    });

    it("builds an unsigned remove-mediator transaction for an admin caller", async () => {
      mockContractService.buildRemoveMediatorTx.mockResolvedValue({ unsignedXdr: "unsigned-remove" });

      const res = await request(app)
        .delete(`/api/admin/contract/mediators/${mediatorAddress}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ unsignedXdr: "unsigned-remove" });
      expect(mockContractService.buildRemoveMediatorTx).toHaveBeenCalledWith({
        adminAddress,
        mediatorAddress,
        trace: expect.objectContaining({ requestId: expect.any(String) }),
      });
      expect(mockPrisma.adminActionAudit.create).toHaveBeenCalledWith({
        data: { action: "REMOVE_MEDIATOR", actorAddress: adminAddress, targetReference: mediatorAddress },
      });
    });

    it("builds an unsigned fee-update transaction for an admin caller", async () => {
      mockContractService.buildUpdateFeeBpsTx.mockResolvedValue({ unsignedXdr: "unsigned-fee" });

      const res = await request(app)
        .patch("/api/admin/contract/fee")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ feeBps: 250 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ unsignedXdr: "unsigned-fee" });
      expect(mockContractService.buildUpdateFeeBpsTx).toHaveBeenCalledWith({
        adminAddress,
        feeBps: 250,
        trace: expect.objectContaining({ requestId: expect.any(String) }),
      });
      expect(mockPrisma.adminActionAudit.create).toHaveBeenCalledWith({
        data: { action: "UPDATE_FEE_BPS", actorAddress: adminAddress, targetReference: "250" },
      });
    });
  });

  describe("timeout handling (issue #10)", () => {
    it("responds 504 when the Soroban client hangs past the configured timeout", async () => {
      mockContractService.buildAddMediatorTx.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ unsignedXdr: "too-late" }), 200)),
      );

      const res = await request(timeoutApp)
        .post("/api/admin/contract/mediators")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ mediatorAddress });

      expect(res.status).toBe(504);
      expect(res.body).toEqual(
        expect.objectContaining({ code: "ADMIN_OPERATION_TIMEOUT" }),
      );
    });

    it("does not time out when the Soroban client responds promptly", async () => {
      mockContractService.buildUpdateFeeBpsTx.mockResolvedValue({ unsignedXdr: "unsigned-fee" });

      const res = await request(timeoutApp)
        .patch("/api/admin/contract/fee")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ feeBps: 100 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ unsignedXdr: "unsigned-fee" });
    });
  });
});

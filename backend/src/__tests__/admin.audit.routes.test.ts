import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createAdminAuditRouter } from "../routes/admin.audit.routes";
import { errorHandler } from "../middleware/errorHandler";

jest.mock("../services/auth.service", () => {
  const actual = jest.requireActual("../services/auth.service");
  return {
    ...actual,
    AuthService: {
      validateToken: jest.fn(async (token: string) => {
        const jsonwebtoken = require("jsonwebtoken");
        return jsonwebtoken.decode(token);
      }),
      isTokenRevoked: jest.fn().mockResolvedValue(false),
    },
  };
});

jest.mock("../services/adminAudit.service", () => ({
  adminAuditService: {
    list: jest.fn(),
  },
}));

import { AuthService } from "../services/auth.service";
import { adminAuditService } from "../services/adminAudit.service";

const mockAdminAuditService = adminAuditService as unknown as {
  list: jest.Mock;
};

const app = express();
app.use(express.json());
app.use("/", createAdminAuditRouter());
app.use(errorHandler);

describe("Admin Audit Routes", () => {
  const adminAddress = StellarSdk.Keypair.random().publicKey();
  const nonAdminAddress = StellarSdk.Keypair.random().publicKey();
  let adminToken: string;
  let nonAdminToken: string;

  beforeAll(() => {
    process.env.ADMIN_STELLAR_PUBKEYS = adminAddress;
    const secret = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
    const now = Math.floor(Date.now() / 1000);
    adminToken = jwt.sign(
      {
        walletAddress: adminAddress,
        jti: "audit-admin-jti",
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        nbf: now - 1,
      },
      secret,
      { algorithm: "HS256" },
    );
    nonAdminToken = jwt.sign(
      {
        walletAddress: nonAdminAddress,
        jti: "audit-nonadmin-jti",
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
    jest.clearAllMocks();
  });

  describe("GET /api/admin/audit", () => {
    it("returns paginated audit entries for an admin", async () => {
      mockAdminAuditService.list.mockResolvedValue({
        items: [
          {
            id: 1,
            action: "TREASURY_WITHDRAW",
            actorAddress: adminAddress,
            targetReference: "GDEST",
            note: "OPS-42",
            createdAt: "2026-07-02T00:00:00.000Z",
          },
        ],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });

      const res = await request(app)
        .get("/api/admin/audit")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    });

    it("forwards page and limit query params to the service", async () => {
      mockAdminAuditService.list.mockResolvedValue({
        items: [],
        pagination: { page: 3, limit: 5, total: 0, totalPages: 1 },
      });

      await request(app)
        .get("/api/admin/audit?page=3&limit=5")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(mockAdminAuditService.list).toHaveBeenCalledWith({ page: 3, limit: 5 });
    });

    it("returns 401 without auth", async () => {
      const res = await request(app).get("/api/admin/audit");
      expect(res.status).toBe(401);
      expect(mockAdminAuditService.list).not.toHaveBeenCalled();
    });

    it("returns 403 with the legacy admin-forbidden envelope for non-admin users", async () => {
      const res = await request(app)
        .get("/api/admin/audit")
        .set("Authorization", `Bearer ${nonAdminToken}`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual(
        expect.objectContaining({ error: "Forbidden: admin access required" }),
      );
      expect(mockAdminAuditService.list).not.toHaveBeenCalled();
    });
  });
});

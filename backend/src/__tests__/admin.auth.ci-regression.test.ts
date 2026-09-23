import express, { Request, Response } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";

import { adminMiddleware } from "../middleware/admin.middleware";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
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
      revokeToken: jest.fn(),
    },
  };
});

const { AuthService } = require("../services/auth.service");

const JWT_SECRET = "a-very-long-secret-that-is-at-least-32-chars-long";
const adminAddress = StellarSdk.Keypair.random().publicKey();
const outsiderAddress = StellarSdk.Keypair.random().publicKey();

function signToken(
  walletAddress: string,
  opts?: { jti?: string; exp?: number },
): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      walletAddress,
      jti: opts?.jti ?? `regression-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      iss: "amana",
      aud: "amana-api",
      nbf: now - 1,
      iat: now - 1,
      exp: opts?.exp ?? now + 3600,
    },
    JWT_SECRET,
    { algorithm: "HS256" },
  );
}

function buildAdminApp(handler: (req: Request, res: Response) => void) {
  const app = express();
  app.get("/admin-test", authMiddleware, adminMiddleware, handler);
  app.use(errorHandler);
  return app;
}

beforeAll(() => {
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.ADMIN_STELLAR_PUBKEYS = adminAddress;
});

beforeEach(() => {
  jest.clearAllMocks();
  (AuthService.isTokenRevoked as jest.Mock).mockResolvedValue(false);
});

describe("Admin route auth CI regression (#115)", () => {
  describe("Auth middleware — token validation", () => {
    it("returns 401 when no Authorization header is provided", async () => {
      const app = buildAdminApp((_req, res) => res.json({ ok: true }));
      const res = await request(app).get("/admin-test");
      expect(res.status).toBe(401);
    });

    it("returns 401 for a malformed bearer token", async () => {
      const app = buildAdminApp((_req, res) => res.json({ ok: true }));
      const res = await request(app)
        .get("/admin-test")
        .set("Authorization", "Bearer not-a-real-jwt");
      expect(res.status).toBe(401);
    });

    it("returns 401 when token is expired", async () => {
      const pastExp = Math.floor(Date.now() / 1000) - 600;
      const token = signToken(adminAddress, { exp: pastExp });
      const app = buildAdminApp((_req, res) => res.json({ ok: true }));
      const res = await request(app)
        .get("/admin-test")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
    });
  });

  describe("Admin middleware — wallet allowlist", () => {
    it("returns 403 when wallet is not in ADMIN_STELLAR_PUBKEYS", async () => {
      const app = buildAdminApp((_req, res) => res.json({ ok: true }));
      const token = signToken(outsiderAddress);
      const res = await request(app)
        .get("/admin-test")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Forbidden/);
    });

    it("returns 200 when wallet is in ADMIN_STELLAR_PUBKEYS", async () => {
      let capturedReqUser: AuthRequest["user"];
      const app = buildAdminApp((req: Request, res: Response) => {
        capturedReqUser = (req as AuthRequest).user;
        res.json({ ok: true });
      });
      const token = signToken(adminAddress);
      const res = await request(app)
        .get("/admin-test")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(capturedReqUser).toBeDefined();
      expect(capturedReqUser?.isAdmin).toBe(true);
    });

    it("returns 403 when multiple admin pubkeys are set but caller is not among them", async () => {
      const anotherAdmin = StellarSdk.Keypair.random().publicKey();
      process.env.ADMIN_STELLAR_PUBKEYS = `${adminAddress},${anotherAdmin}`;
      const app = buildAdminApp((_req, res) => res.json({ ok: true }));
      const outsiderToken = signToken(outsiderAddress);
      const res = await request(app)
        .get("/admin-test")
        .set("Authorization", `Bearer ${outsiderToken}`);
      expect(res.status).toBe(403);
    });

    it("allows access when wallet is among multiple configured admin pubkeys", async () => {
      const secondAdmin = StellarSdk.Keypair.random().publicKey();
      process.env.ADMIN_STELLAR_PUBKEYS = `${adminAddress},${secondAdmin}`;
      let capturedUser: AuthRequest["user"];
      const app = buildAdminApp((req: Request, res: Response) => {
        capturedUser = (req as AuthRequest).user;
        res.json({ ok: true });
      });
      const token = signToken(secondAdmin);
      const res = await request(app)
        .get("/admin-test")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(capturedUser?.isAdmin).toBe(true);
    });

    it("propagates walletAddress and isAdmin through the middleware chain", async () => {
      let capturedUser: AuthRequest["user"];
      const app = buildAdminApp((req: Request, res: Response) => {
        capturedUser = (req as AuthRequest).user;
        res.json({ ok: true });
      });
      const token = signToken(adminAddress);
      const res = await request(app)
        .get("/admin-test")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      const user = capturedUser;
      expect(user?.isAdmin).toBe(true);
      expect(typeof user?.walletAddress).toBe("string");
      expect((user?.walletAddress ?? "").length).toBeGreaterThan(0);
    });
  });

  describe("Token revocation", () => {
    it("returns 401 when admin token JTI is revoked", async () => {
      (AuthService.isTokenRevoked as jest.Mock).mockImplementation(
        async (jti: string) => jti === "revoked-jti-ci",
      );
      const token = signToken(adminAddress, { jti: "revoked-jti-ci" });
      const app = buildAdminApp((_req, res) => res.json({ ok: true }));
      const res = await request(app)
        .get("/admin-test")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/revoked/);
    });

    it("allows access when token JTI is not revoked", async () => {
      (AuthService.isTokenRevoked as jest.Mock).mockResolvedValue(false);
      const token = signToken(adminAddress, { jti: "valid-jti-ci" });
      const app = buildAdminApp((_req, res) => res.json({ ok: true }));
      const res = await request(app)
        .get("/admin-test")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/admin/auth/claims — endpoint", () => {
    it("returns 401 when unauthenticated", async () => {
      const app = express();
      app.use(express.json());
      const { createAdminAuthRouter } = require("../routes/admin.auth.routes");
      app.use("/", createAdminAuthRouter());
      app.use(errorHandler);

      const res = await request(app).get("/api/admin/auth/claims");
      expect(res.status).toBe(401);
    });

    it("returns 403 for a non-admin wallet", async () => {
      const app = express();
      app.use(express.json());
      const { createAdminAuthRouter } = require("../routes/admin.auth.routes");
      app.use("/", createAdminAuthRouter());
      app.use(errorHandler);

      const token = signToken(outsiderAddress);
      const res = await request(app)
        .get("/api/admin/auth/claims")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it("returns sanitized claims for an authorized admin", async () => {
      const app = express();
      app.use(express.json());
      const { createAdminAuthRouter } = require("../routes/admin.auth.routes");
      app.use("/", createAdminAuthRouter());
      app.use(errorHandler);

      const token = signToken(adminAddress, { jti: "claims-ci-jti" });
      const res = await request(app)
        .get("/api/admin/auth/claims")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.walletAddress).toBeDefined();
      expect(res.body.tokenId).toBe("claims-ci-jti");
      expect(res.body.issuedAt).toBeDefined();
      expect(res.body.expiresAt).toBeDefined();
      expect(res.body).not.toHaveProperty("nbf");
      expect(res.body).not.toHaveProperty("sub");
    });
  });

  describe("POST /api/admin/sessions/revoke — endpoint", () => {
    it("revokes an active admin session", async () => {
      const app = express();
      app.use(express.json());
      const { createAdminAuthRouter } = require("../routes/admin.auth.routes");
      app.use("/", createAdminAuthRouter());
      app.use(errorHandler);

      const token = signToken(adminAddress, { jti: "revoke-ci-jti" });
      const res = await request(app)
        .post("/api/admin/sessions/revoke")
        .set("Authorization", `Bearer ${token}`)
        .send({ jti: "target-ci-jti" });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/revoked/i);
      expect(AuthService.revokeToken).toHaveBeenCalledWith(
        "target-ci-jti",
        expect.any(Number),
      );
    });

    it("returns 401 when unauthenticated", async () => {
      const app = express();
      app.use(express.json());
      const { createAdminAuthRouter } = require("../routes/admin.auth.routes");
      app.use("/", createAdminAuthRouter());
      app.use(errorHandler);

      const res = await request(app)
        .post("/api/admin/sessions/revoke")
        .send({ jti: "some-jti" });
      expect(res.status).toBe(401);
    });

    it("returns 403 for non-admin caller", async () => {
      const app = express();
      app.use(express.json());
      const { createAdminAuthRouter } = require("../routes/admin.auth.routes");
      app.use("/", createAdminAuthRouter());
      app.use(errorHandler);

      const token = signToken(outsiderAddress);
      const res = await request(app)
        .post("/api/admin/sessions/revoke")
        .set("Authorization", `Bearer ${token}`)
        .send({ jti: "some-jti" });
      expect(res.status).toBe(403);
    });
  });

  describe("Cross-endpoint authentication consistency", () => {
    it("unauthenticated requests are rejected with 401", async () => {
      const app = buildAdminApp((_req, res) => res.json({ ok: true }));
      const res = await request(app).get("/admin-test");
      expect(res.status).toBe(401);
    });

    it("non-admin wallets are rejected with 403", async () => {
      const app = buildAdminApp((_req, res) => res.json({ ok: true }));
      const token = signToken(outsiderAddress);
      const res = await request(app)
        .get("/admin-test")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it("admin wallets are granted access", async () => {
      const app = buildAdminApp((_req, res) => res.json({ ok: true }));
      const token = signToken(adminAddress);
      const res = await request(app)
        .get("/admin-test")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
    });
  });

  describe("Error response shape consistency", () => {
    it("returns 403 with error message for unauthorized admin access", async () => {
      const app = buildAdminApp((_req, res) => res.json({ ok: true }));
      const token = signToken(outsiderAddress);
      const res = await request(app)
        .get("/admin-test")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error).toMatch(/Forbidden/i);
    });

    it("does not leak the admin allowlist in 403 error body", async () => {
      const app = buildAdminApp((_req, res) => res.json({ ok: true }));
      const token = signToken(outsiderAddress);
      const res = await request(app)
        .get("/admin-test")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(adminAddress);
    });
  });
});

/**
 * Admin auth token replay protection tests — Issue #39.
 *
 * Covers:
 *  - Admin route rejects expired tokens (exp claim enforcement)
 *  - Admin route rejects revoked tokens (jti-based replay protection)
 *  - Admin route rejects future nbf tokens
 *  - Admin route rejects token after logout (simulated revocation)
 *  - Valid admin token works (happy path)
 *  - Missing/invalid auth headers on admin routes
 *  - Wrong claims (iss, aud, missing jti) rejected on admin routes
 *  - Access control still enforced after auth passes
 */

import express, { Request, Response } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { adminMiddleware } from "../middleware/admin.middleware";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { errorHandler } from "../middleware/errorHandler";

// ── Mock AuthService — fully self-contained, no jest.requireActual ────────────
// This avoids pulling in env/redis/prisma from the real auth.service.ts module,
// while still performing real JWT verification (expiry, nbf, iss, aud, jti).
jest.mock("../services/auth.service", () => {
  const jsonwebtoken = require("jsonwebtoken");
  const { AppError, ErrorCode } = require("../errors/errorCodes");

  const isTokenRevokedMock = jest.fn();

  const mockAuthService = {
    isTokenRevoked: isTokenRevokedMock,
    validateToken: jest.fn(async (token: string) => {
      try {
        const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET!, {
          algorithms: ["HS256"],
          issuer: process.env.JWT_ISSUER,
          audience: process.env.JWT_AUDIENCE,
        });

        if (!decoded.jti) {
          throw new AppError(ErrorCode.AUTH_ERROR, "Unauthorized: missing jti claim", 401);
        }

        if (await isTokenRevokedMock(decoded.jti)) {
          throw new AppError(ErrorCode.AUTH_ERROR, "Unauthorized: token has been revoked", 401);
        }

        return decoded;
      } catch (error: unknown) {
        // Map JWT library errors to AppErrors (mirrors real AuthService behaviour)
        if (error instanceof AppError) throw error;
        const err = error as Error & { name?: string };
        if (err.name === "TokenExpiredError") throw new AppError(ErrorCode.AUTH_ERROR, "Token expired", 401);
        if (err.name === "NotBeforeError") throw new AppError(ErrorCode.AUTH_ERROR, "Token not yet valid", 401);
        if (err.name === "JsonWebTokenError") throw new AppError(ErrorCode.AUTH_ERROR, "Invalid token", 401);
        throw new AppError(ErrorCode.INFRA_ERROR, "Token validation failed", 500);
      }
    }),
  };

  return { AuthService: mockAuthService };
});

// ── Mock access control so we can test auth behaviour without real allowlists ──
jest.mock("../lib/accessControl", () => ({
  isMediatorAddress: jest.fn(),
  getAdminAllowlistLowercase: jest.fn().mockReturnValue(new Set<string>()),
}));

// Extract mocked references AFTER jest.mock setup (imports resolve to mocks)
import { AuthService } from "../services/auth.service";
const { isMediatorAddress: _rawIsMediator } = require("../lib/accessControl");

const mockIsTokenRevoked = AuthService.isTokenRevoked as jest.Mock;
const mockIsMediator = _rawIsMediator as jest.Mock;

const JWT_SECRET = "a-very-long-secret-that-is-at-least-32-chars-long";
const JWT_ISSUER = "amana";
const JWT_AUDIENCE = "amana-api";

const ADMIN_ADDRESS = "gadmin11111111111111111111111111111111111111111111111111";

function makeToken(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const base = {
    sub: ADMIN_ADDRESS,
    walletAddress: ADMIN_ADDRESS,
    jti: `admin-replay-jti-${Math.random().toString(36).slice(2, 10)}`,
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    iat: now,
    nbf: now,
    exp: now + 86400,
  };
  return jwt.sign({ ...base, ...overrides }, JWT_SECRET, { algorithm: "HS256" });
}

function buildAdminApp(handler?: (req: Request, res: Response) => void) {
  const app = express();
  app.get(
    "/admin/protected",
    authMiddleware,
    adminMiddleware,
    handler ?? ((_req: Request, res: Response) => {
      res.json({ ok: true, admin: true });
    }),
  );
  app.use(errorHandler);
  return app;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.JWT_ISSUER = JWT_ISSUER;
  process.env.JWT_AUDIENCE = JWT_AUDIENCE;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockIsTokenRevoked.mockResolvedValue(false);
  mockIsMediator.mockReturnValue(true); // admin access granted by default
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Happy path — valid admin token
// ─────────────────────────────────────────────────────────────────────────────

describe("Admin auth — happy path", () => {
  it("grants access with a fully valid admin token", async () => {
    const app = buildAdminApp();
    const token = makeToken();

    const res = await request(app)
      .get("/admin/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.admin).toBe(true);
  });

  it("sets isAdmin = true on the request context", async () => {
    let capturedUser: AuthRequest["user"];
    const app = buildAdminApp((req: Request, res: Response) => {
      capturedUser = (req as AuthRequest).user;
      res.json({ ok: true });
    });

    const token = makeToken();
    const res = await request(app)
      .get("/admin/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(capturedUser?.isAdmin).toBe(true);
    expect(capturedUser?.walletAddress).toBe(ADMIN_ADDRESS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Expired token rejection
// ─────────────────────────────────────────────────────────────────────────────

describe("Admin auth — expired token rejection", () => {
  it("rejects an expired token on an admin route with 401", async () => {
    const app = buildAdminApp();
    const now = Math.floor(Date.now() / 1000);
    const expiredToken = makeToken({
      iat: now - 200,
      nbf: now - 200,
      exp: now - 100,
    });

    const res = await request(app)
      .get("/admin/protected")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired|unauthorized/i);
  });

  it("rejects a token that expired just 1 second ago", async () => {
    const app = buildAdminApp();
    const now = Math.floor(Date.now() / 1000);
    const token = makeToken({
      iat: now - 86401,
      nbf: now - 86401,
      exp: now - 1,
    });

    const res = await request(app)
      .get("/admin/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it("rejects an expired token even when the caller would otherwise be an admin", async () => {
    // Expiry must be checked before role evaluation — auth comes first
    const app = buildAdminApp();
    const now = Math.floor(Date.now() / 1000);
    const expiredToken = makeToken({
      iat: now - 200,
      nbf: now - 200,
      exp: now - 50,
    });

    const res = await request(app)
      .get("/admin/protected")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Revoked token (jti-based replay) rejection
// ─────────────────────────────────────────────────────────────────────────────

describe("Admin auth — revoked token (jti replay) rejection", () => {
  it("rejects a revoked token on an admin route with 401", async () => {
    mockIsTokenRevoked.mockResolvedValue(true);
    const app = buildAdminApp();
    const token = makeToken();

    const res = await request(app)
      .get("/admin/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_ERROR");
  });

  it("calls isTokenRevoked with the correct jti from the admin token", async () => {
    mockIsTokenRevoked.mockResolvedValue(false);
    const app = buildAdminApp();
    const token = makeToken({ jti: "admin-specific-jti-abc" });

    await request(app)
      .get("/admin/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(mockIsTokenRevoked).toHaveBeenCalledWith("admin-specific-jti-abc");
  });

  it("rejects a replayed token (same jti) after first successful use and subsequent revocation", async () => {
    // Simulate: token works once, gets revoked, then replayed
    const app = buildAdminApp();
    const token = makeToken({ jti: "replay-test-jti" });

    // First request succeeds
    const firstRes = await request(app)
      .get("/admin/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(firstRes.status).toBe(200);

    // Token gets revoked (simulating logout or admin revocation)
    mockIsTokenRevoked.mockResolvedValue(true);

    // Replay attempt fails
    const replayRes = await request(app)
      .get("/admin/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(replayRes.status).toBe(401);
    expect(replayRes.body.code).toBe("AUTH_ERROR");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Future nbf (not-before) rejection
// ─────────────────────────────────────────────────────────────────────────────

describe("Admin auth — nbf (not yet valid) rejection", () => {
  it("rejects a token where nbf is in the future on an admin route", async () => {
    const app = buildAdminApp();
    const now = Math.floor(Date.now() / 1000);
    const token = makeToken({ nbf: now + 3600, iat: now, exp: now + 7200 });

    const res = await request(app)
      .get("/admin/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Missing / malformed auth header
// ─────────────────────────────────────────────────────────────────────────────

describe("Admin auth — missing / malformed header", () => {
  it("returns 401 when no Authorization header is present on an admin route", async () => {
    const app = buildAdminApp();
    const res = await request(app).get("/admin/protected");
    expect(res.status).toBe(401);
  });

  it("returns 401 for a non-Bearer scheme on an admin route", async () => {
    const app = buildAdminApp();
    const res = await request(app)
      .get("/admin/protected")
      .set("Authorization", "Basic dXNlcjpwYXNz");
    expect(res.status).toBe(401);
  });

  it("returns 401 for a completely invalid token string on an admin route", async () => {
    const app = buildAdminApp();
    const res = await request(app)
      .get("/admin/protected")
      .set("Authorization", "Bearer not.a.jwt");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an empty Bearer token on an admin route", async () => {
    const app = buildAdminApp();
    const res = await request(app)
      .get("/admin/protected")
      .set("Authorization", "Bearer ");
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Wrong claims rejection
// ─────────────────────────────────────────────────────────────────────────────

describe("Admin auth — wrong claims", () => {
  it("rejects token with wrong issuer on an admin route", async () => {
    const app = buildAdminApp();
    const token = makeToken({ iss: "evil-issuer" });
    const res = await request(app)
      .get("/admin/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("rejects token with wrong audience on an admin route", async () => {
    const app = buildAdminApp();
    const token = makeToken({ aud: "wrong-audience" });
    const res = await request(app)
      .get("/admin/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("rejects token missing jti claim on an admin route", async () => {
    mockIsTokenRevoked.mockResolvedValue(false);
    const app = buildAdminApp();
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: ADMIN_ADDRESS,
      walletAddress: ADMIN_ADDRESS,
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      iat: now,
      nbf: now,
      exp: now + 86400,
    };
    const token = jwt.sign(payload, JWT_SECRET, { algorithm: "HS256" });

    const res = await request(app)
      .get("/admin/protected")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_ERROR");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Access control still enforced after auth passes
// ─────────────────────────────────────────────────────────────────────────────

describe("Admin auth — access control enforcement", () => {
  it("returns 403 when the caller passes auth but is not on the admin allowlist", async () => {
    mockIsMediator.mockReturnValue(false); // not an admin
    const app = buildAdminApp();
    const token = makeToken();

    const res = await request(app)
      .get("/admin/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/forbidden/i);
  });
});

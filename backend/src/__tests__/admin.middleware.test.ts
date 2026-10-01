import express, { Request, Response } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
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
    },
  };
});

const JWT_SECRET = "a-very-long-secret-that-is-at-least-32-chars-long";
const JWT_ISSUER = "amana";
const JWT_AUDIENCE = "amana-api";

function makeToken(walletAddress: string) {
  const now = Math.floor(Date.now() / 1000);
  // Production `issueToken()` normalises wallet addresses to lowercase in the
  // JWT payload. Match that behaviour so the test reflects real-world identity
  // propagation.
  const normalised = walletAddress.toLowerCase();
  return jwt.sign(
    {
      sub: normalised,
      walletAddress: normalised,
      jti: `jti-${walletAddress.slice(0, 8)}`,
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      iat: now,
      nbf: now,
      exp: now + 86400,
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
  process.env.JWT_ISSUER = JWT_ISSUER;
  process.env.JWT_AUDIENCE = JWT_AUDIENCE;
});

afterEach(() => {
  jest.clearAllMocks();
  delete process.env.ADMIN_STELLAR_PUBKEYS;
});

describe("adminMiddleware — identity propagation", () => {
  it("sets req.user.isAdmin = true when caller is on the admin allowlist", async () => {
    const adminKey = "GCADMIN11111111111111111111111111111111111111111111111111";
    // Allowlist env var must use the same normalisation as the JWT (lowercase)
    // so that `isMediatorAddress` finds a match.
    process.env.ADMIN_STELLAR_PUBKEYS = adminKey.toLowerCase();

    let capturedReqUser: AuthRequest["user"];
    const app = buildAdminApp((req: Request, res: Response) => {
      capturedReqUser = (req as AuthRequest).user;
      res.json({ ok: true });
    });

    const token = makeToken(adminKey);
    const res = await request(app)
      .get("/admin-test")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(capturedReqUser).toBeDefined();
    expect(capturedReqUser?.isAdmin).toBe(true);
    expect(capturedReqUser?.walletAddress).toBe(adminKey.toLowerCase());
  });

  it("does NOT set isAdmin when caller is not on the admin allowlist", async () => {
    const normalKey = "GCNORMAL11111111111111111111111111111111111111111111111111";
    process.env.ADMIN_STELLAR_PUBKEYS = "gadmin11111111111111111111111111111111111111111111111111";

    const app = buildAdminApp((_req: Request, res: Response) => {
      res.json({ ok: true });
    });

    const token = makeToken(normalKey);
    const res = await request(app)
      .get("/admin-test")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/);
  });

  it("returns 401 when no auth token is provided", async () => {
    process.env.ADMIN_STELLAR_PUBKEYS = "gadmin11111111111111111111111111111111111111111111111111";

    const app = buildAdminApp((_req: Request, res: Response) => {
      res.json({ ok: true });
    });

    const res = await request(app).get("/admin-test");
    expect(res.status).toBe(401);
  });

  it("propagates walletAddress and isAdmin through the middleware chain", async () => {
    const adminKey = "GCADMIN22222222222222222222222222222222222222222222222222";
    process.env.ADMIN_STELLAR_PUBKEYS = adminKey.toLowerCase();

    let capturedUser: AuthRequest["user"];
    const app = buildAdminApp((req: Request, res: Response) => {
      capturedUser = (req as AuthRequest).user;
      res.json({ ok: true });
    });

    const token = makeToken(adminKey);
    const res = await request(app)
      .get("/admin-test")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const user = capturedUser;
    expect(user?.isAdmin).toBe(true);
    expect(user?.walletAddress).toBe(adminKey.toLowerCase());
    expect(user?.sub).toBe(adminKey.toLowerCase());
  });

  it("grants access when multiple admin pubkeys are configured", async () => {
    const secondAdmin = "GCADMIN33333333333333333333333333333333333333333333333333";
    const firstAdmin = "GCADMIN11111111111111111111111111111111111111111111111111";
    process.env.ADMIN_STELLAR_PUBKEYS = `${firstAdmin.toLowerCase()},${secondAdmin.toLowerCase()}`;

    let capturedUser: AuthRequest["user"];
    const app = buildAdminApp((req: Request, res: Response) => {
      capturedUser = (req as AuthRequest).user;
      res.json({ ok: true });
    });

    const token = makeToken(secondAdmin);
    const res = await request(app)
      .get("/admin-test")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(capturedUser?.isAdmin).toBe(true);
  });
});

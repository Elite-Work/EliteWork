/**
 * Unit tests for the CSRF middleware (csrfProtection + csrfToken).
 *
 * Coverage contract (as the issue requires):
 *  - pass-through: safe methods, non-admin paths, and Bearer-authenticated
 *    requests bypass the CSRF check entirely;
 *  - rejection: state-changing admin requests without a valid double-submit
 *    token pair are answered directly with 403 "CSRF token required";
 *  - error-propagation: next() is invoked exactly once with no error on the
 *    pass-through paths, and never invoked at all on the reject path (the
 *    middleware answers 403 itself instead of forwarding to the error handler).
 *
 * The middleware functions are exercised directly (no Express app) to give
 * fast, hermetic coverage of the guard logic itself.
 */
import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { csrfProtection, csrfToken } from "../middleware/csrf.middleware";

interface FakeRequest {
  path: string;
  method: string;
  headers: Record<string, string | undefined>;
}

interface RunResult {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  nextCalled: boolean;
  nextArgs: unknown[];
}

function makeResponse() {
  const state = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
  };
  const res = {
    status: (code: number) => {
      state.statusCode = code;
      return res;
    },
    json: (body?: unknown) => {
      state.body = body;
      return res;
    },
    setHeader: (key: string, value: string) => {
      state.headers[key] = value;
    },
  };
  return { res, state };
}

function runCsrf(req: FakeRequest): RunResult {
  const { res, state } = makeResponse();
  const nextArgs: unknown[] = [];
  const next: NextFunction = (arg?: unknown) => {
    nextArgs.push(arg);
  };
  csrfProtection(req as unknown as Request, res as unknown as Response, next);
  return {
    statusCode: state.statusCode,
    body: state.body,
    headers: state.headers,
    nextCalled: nextArgs.length > 0,
    nextArgs,
  };
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function validCookieHeader(token: string): string {
  return `csrf_token=${token}; Path=/; SameSite=Strict`;
}

// Admin endpoints covered by the protection layer in app.ts
// (adminFeatureGate + csrfProtection).
const PROTECTED_PATHS = [
  "/admin",
  "/admin/features",
  "/admin/payouts",
  "/api/admin/payouts",
  "/api/admin/streams/123/suspend",
];

// ── pass-through ─────────────────────────────────────────────────────────────

describe("csrfProtection — pass-through", () => {
  it("allows state-changing requests to non-admin paths without any CSRF material", () => {
    const result = runCsrf({ path: "/trades", method: "POST", headers: {} });
    expect(result.nextCalled).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.body).toBeUndefined();
  });

  it.each(["GET", "HEAD", "OPTIONS"])(
    "allows safe method %s on admin paths without any CSRF material",
    (method) => {
      const result = runCsrf({ path: "/admin/features", method, headers: {} });
      expect(result.nextCalled).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.body).toBeUndefined();
    },
  );

  it("allows Bearer-authenticated admin requests without any CSRF material", () => {
    const result = runCsrf({
      path: "/api/admin/payouts",
      method: "POST",
      headers: { authorization: "Bearer some.jwt.token" },
    });
    expect(result.nextCalled).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.body).toBeUndefined();
  });
});

// ── rejection ─────────────────────────────────────────────────────────────────

describe("csrfProtection — rejection", () => {
  it.each(PROTECTED_PATHS)(
    "returns 403 CSRF token required for POST %s without any CSRF material",
    (path) => {
      const result = runCsrf({ path, method: "POST", headers: {} });
      expect(result.statusCode).toBe(403);
      expect(result.body).toEqual({ error: "CSRF token required" });
      expect(result.nextCalled).toBe(false);
    },
  );

  it("returns 403 when the CSRF cookie is missing even if a header is present", () => {
    const token = generateToken();
    const result = runCsrf({
      path: "/admin/payouts",
      method: "POST",
      headers: { "x-csrf-token": token },
    });
    expect(result.statusCode).toBe(403);
    expect(result.body).toEqual({ error: "CSRF token required" });
    expect(result.nextCalled).toBe(false);
  });

  it("returns 403 when the x-csrf-token header is missing even if a cookie is present", () => {
    const token = generateToken();
    const result = runCsrf({
      path: "/admin/payouts",
      method: "POST",
      headers: { cookie: validCookieHeader(token) },
    });
    expect(result.statusCode).toBe(403);
    expect(result.body).toEqual({ error: "CSRF token required" });
    expect(result.nextCalled).toBe(false);
  });

  it("returns 403 when the header does not match the cookie value", () => {
    const token = generateToken();
    const mismatch = crypto.randomBytes(32).toString("hex");
    const result = runCsrf({
      path: "/admin/payouts",
      method: "POST",
      headers: { cookie: validCookieHeader(token), "x-csrf-token": mismatch },
    });
    expect(result.statusCode).toBe(403);
    expect(result.body).toEqual({ error: "CSRF token required" });
    expect(result.nextCalled).toBe(false);
  });

  it("returns 403 (without throwing) when the header length differs from the cookie length", () => {
    const token = generateToken();
    const result = runCsrf({
      path: "/admin/payouts",
      method: "POST",
      headers: { cookie: validCookieHeader(token), "x-csrf-token": token.slice(0, 63) },
    });
    expect(result.statusCode).toBe(403);
    expect(result.body).toEqual({ error: "CSRF token required" });
    expect(result.nextCalled).toBe(false);
  });
});

// ── success ───────────────────────────────────────────────────────────────────

describe("csrfProtection — success", () => {
  it("calls next() with no error when cookie and header match", () => {
    const token = generateToken();
    const result = runCsrf({
      path: "/admin/payouts",
      method: "POST",
      headers: { cookie: validCookieHeader(token), "x-csrf-token": token },
    });
    expect(result.nextCalled).toBe(true);
    expect(result.nextArgs).toHaveLength(1);
    expect(result.nextArgs[0]).toBeUndefined();
    expect(result.statusCode).toBe(200);
    expect(result.body).toBeUndefined();
  });

  it("accepts the double-submit token when it arrives alongside unrelated cookies", () => {
    const token = generateToken();
    const result = runCsrf({
      path: "/admin/payouts",
      method: "POST",
      headers: {
        cookie: `session=abc123; ${validCookieHeader(token)}`,
        "x-csrf-token": token,
      },
    });
    expect(result.nextCalled).toBe(true);
    expect(result.nextArgs).toHaveLength(1);
    expect(result.nextArgs[0]).toBeUndefined();
  });

  it("accepts a valid token on deep admin sub-paths", () => {
    const token = generateToken();
    const result = runCsrf({
      path: "/api/admin/streams/123/suspend",
      method: "POST",
      headers: { cookie: validCookieHeader(token), "x-csrf-token": token },
    });
    expect(result.nextCalled).toBe(true);
    expect(result.nextArgs[0]).toBeUndefined();
  });
});

// ── error propagation / next() contract ────────────────────────────────────────

describe("csrfProtection — next() error contract", () => {
  it("invokes next exactly once with no error for a valid authenticated admin POST", () => {
    const token = generateToken();
    const result = runCsrf({
      path: "/admin/payouts",
      method: "POST",
      headers: { cookie: validCookieHeader(token), "x-csrf-token": token },
    });
    expect(result.nextCalled).toBe(true);
    expect(result.nextArgs).toHaveLength(1);
    expect(result.nextArgs[0]).toBeUndefined();
  });

  it("never forwards an Error instance to next()", () => {
    const token = generateToken();
    const guardedRequests: Array<{ path: string; method: string; headers: Record<string, string | undefined> }> = [
      { path: "/admin", method: "POST", headers: { cookie: validCookieHeader(token), "x-csrf-token": token } },
      { path: "/admin/audit", method: "GET", headers: {} },
      { path: "/api/admin/payouts", method: "POST", headers: { cookie: validCookieHeader(token), "x-csrf-token": token } },
      { path: "/api/admin/dlq/q/replay", method: "POST", headers: {} },
      { path: "/trades", method: "POST", headers: {} },
    ];

    for (const req of guardedRequests) {
      const result = runCsrf(req);
      if (result.nextCalled) {
        expect(result.nextArgs[0]).not.toBeInstanceOf(Error);
      } else {
        // Rejected requests are answered with a 403 response, never routed to
        // the error handler via next(err).
        expect(result.statusCode).toBe(403);
        expect(result.body).toEqual({ error: "CSRF token required" });
      }
    }
  });
});

// ── csrfToken issuance ─────────────────────────────────────────────────────────

describe("csrfToken", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("issues a random 64-char hex token, sets the CSRF cookie, and returns it in the body", () => {
    const { res, state } = makeResponse();
    csrfToken({} as unknown as Request, res as unknown as Response);
    const body = state.body as { csrfToken: string };
    expect(typeof body.csrfToken).toBe("string");
    expect(body.csrfToken).toMatch(/^[a-f0-9]{64}$/);
    expect(state.headers["Set-Cookie"]).toBe(`csrf_token=${body.csrfToken}; Path=/; SameSite=Strict`);
  });

  it("omits the Secure attribute outside production", () => {
    expect(process.env.NODE_ENV).not.toBe("production");
    const { res, state } = makeResponse();
    csrfToken({} as unknown as Request, res as unknown as Response);
    const body = state.body as { csrfToken: string };
    expect(state.headers["Set-Cookie"]).toBe(`csrf_token=${body.csrfToken}; Path=/; SameSite=Strict`);
  });

  it("adds the Secure attribute when NODE_ENV is production", () => {
    process.env.NODE_ENV = "production";
    const { res, state } = makeResponse();
    csrfToken({} as unknown as Request, res as unknown as Response);
    const body = state.body as { csrfToken: string };
    expect(state.headers["Set-Cookie"]).toBe(`csrf_token=${body.csrfToken}; Path=/; SameSite=Strict; Secure`);
  });
});

/**
 * Service-oriented unit tests for the adminAuth middleware.
 *
 * These tests exercise adminMiddleware in isolation with mocked external
 * dependencies, covering all auth branches: success, missing user, empty
 * walletAddress, invalid role (non-admin), and error response shapes.
 *
 * Issue #50
 */

import { Response } from "express";
import { adminMiddleware } from "../middleware/admin.middleware";
import { AuthRequest } from "../services/auth.service";

// ── Mock redis so tests never attempt network connections ─────────────────
jest.mock("../lib/redis", () => ({
  redis: {
    exists: jest.fn().mockResolvedValue(0),
    set: jest.fn().mockResolvedValue("OK"),
  },
}));

// ── Mock accessControl so tests never touch env vars ───────────────────────
jest.mock("../lib/accessControl", () => ({
  isMediatorAddress: jest.fn(),
}));

const { isMediatorAddress } = require("../lib/accessControl");

// ── Mock OpenTelemetry so tests don't interact with real tracer ────────────
jest.mock("@opentelemetry/api", () => ({
  trace: {
    getActiveSpan: jest.fn().mockReturnValue({
      setAttributes: jest.fn(),
      setStatus: jest.fn(),
      spanContext: jest.fn().mockReturnValue({ traceId: "trace-1", spanId: "span-1" }),
      isRecording: jest.fn().mockReturnValue(true),
    }),
  },
  SpanStatusCode: { ERROR: 2, OK: 1 },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN_ADDRESS = "GADMINVALIDTESTACCOUNT000000000000000000000000000000";

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
};

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response & MockResponse;
}

function mockReq(overrides: Partial<AuthRequest["user"]> = {}, userUndefined = false): Partial<AuthRequest> {
  if (userUndefined) return {};
  return {
    user: {
      walletAddress: ADMIN_ADDRESS,
      sub: "admin-sub",
      jti: "jti-123",
      tv: 1,
      ...overrides,
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("adminMiddleware — service-oriented unit tests", () => {
  let res: ReturnType<typeof mockRes>;
  let next: jest.Mock;

  beforeEach(() => {
    res = mockRes();
    next = jest.fn();
    jest.clearAllMocks();
  });

  // ── Success path ─────────────────────────────────────────────────────────

  describe("success — admin access granted", () => {
    it("calls next() when user is on the admin allowlist", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(true);
      const req = mockReq();

      await adminMiddleware(req as AuthRequest, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("sets req.user.isAdmin = true when access is granted", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(true);
      const req = mockReq();

      await adminMiddleware(req as AuthRequest, res, next);

      expect(req.user?.isAdmin).toBe(true);
      expect(next).toHaveBeenCalled();
    });

    it("preserves existing user properties while adding isAdmin flag", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(true);
      const req = mockReq({ walletAddress: ADMIN_ADDRESS.toLowerCase(), sub: "test-sub", jti: "test-jti" });

      await adminMiddleware(req as AuthRequest, res, next);

      expect(req.user?.isAdmin).toBe(true);
      expect(req.user?.walletAddress).toBe(ADMIN_ADDRESS.toLowerCase());
      expect(req.user?.sub).toBe("test-sub");
      expect(req.user?.jti).toBe("test-jti");
    });

    it("trims whitespace from walletAddress before checking the allowlist", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(true);
      const req = mockReq({ walletAddress: `  ${ADMIN_ADDRESS}  ` });

      await adminMiddleware(req as AuthRequest, res, next);

      // isMediatorAddress should be called with the trimmed address
      expect(isMediatorAddress).toHaveBeenCalledWith(ADMIN_ADDRESS);
      expect(next).toHaveBeenCalled();
    });
  });

  // ── Missing token / user ─────────────────────────────────────────────────

  describe("missing token — user not present", () => {
    it("returns 403 when req.user is undefined", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(false);
      const req = mockReq({}, true); // no user

      await adminMiddleware(req as AuthRequest, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Forbidden: admin access required",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 403 when req.user exists but walletAddress is undefined", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(false);
      const req = mockReq({ walletAddress: undefined as unknown as string });

      await adminMiddleware(req as AuthRequest, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 403 when req.user exists but walletAddress is an empty string", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(false);
      const req = mockReq({ walletAddress: "" });

      await adminMiddleware(req as AuthRequest, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 403 when req.user exists but walletAddress is only whitespace", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(false);
      const req = mockReq({ walletAddress: "   " });

      await adminMiddleware(req as AuthRequest, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ── Invalid role / wrong role ────────────────────────────────────────────

  describe("wrong role — user not on admin allowlist", () => {
    it("returns 403 when isMediatorAddress returns false", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(false);
      const req = mockReq();

      await adminMiddleware(req as AuthRequest, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: "Forbidden: admin access required",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("does NOT set isAdmin flag when access is denied", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(false);
      const req = mockReq();

      await adminMiddleware(req as AuthRequest, res, next);

      expect(req.user?.isAdmin).toBeUndefined();
    });

    it("correctly checks the user's address against the allowlist", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(false);
      const req = mockReq({ walletAddress: "GNONADMINKEY12345678901234567890123456789012345678901234" });

      await adminMiddleware(req as AuthRequest, res, next);

      expect(isMediatorAddress).toHaveBeenCalledWith("GNONADMINKEY12345678901234567890123456789012345678901234");
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ── Error response shape assertions ──────────────────────────────────────

  describe("error response shapes", () => {
    it("returns JSON with the correct error property when access is denied", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(false);
      const req = mockReq();

      await adminMiddleware(req as AuthRequest, res, next);

      const jsonArg = res.json.mock.calls[0][0];
      expect(jsonArg).toEqual({ error: "Forbidden: admin access required" });
      expect(jsonArg).toHaveProperty("error");
      expect(typeof jsonArg.error).toBe("string");
    });

    it("returns 403 status code with the forbidden error message", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(false);
      const req = mockReq();

      await adminMiddleware(req as AuthRequest, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringMatching(/Forbidden/) })
      );
    });

    it("does not leak internal allowlist details in the error response", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(false);
      const req = mockReq({ walletAddress: "ATTACKERKEY000000000000000000000000000000000000000000000000" });

      await adminMiddleware(req as AuthRequest, res, next);

      const jsonArg = res.json.mock.calls[0][0];
      // The response should not expose the address or any allowlist details
      expect(JSON.stringify(jsonArg)).not.toContain("ATTACKERKEY");
      expect(JSON.stringify(jsonArg)).not.toContain("allowlist");
      expect(JSON.stringify(jsonArg)).not.toContain(ADMIN_ADDRESS);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("does not call next() after sending a 403 response", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(false);
      const req = mockReq();

      await adminMiddleware(req as AuthRequest, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("does not send a response body when access is granted (delegates to next handler)", async () => {
      (isMediatorAddress as jest.Mock).mockReturnValue(true);
      const req = mockReq();

      await adminMiddleware(req as AuthRequest, res, next);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});

/**
 * adminAuth integration coverage (#53).
 *
 * The other admin.*.routes.test.ts files each build a bespoke express app
 * around a single router, so they never exercise `authMiddleware` +
 * `adminMiddleware` + `adminFeatureGate` wired together the way a real
 * request hits them. This suite boots the real `createApp()` (the same
 * bootstrap `app.test.ts` smoke-tests `/health` through) and drives actual
 * admin route handlers end to end, asserting that adminAuth itself - not a
 * mocked stand-in - is what turns a non-admin caller away with 403.
 *
 * Only the data layer (`adminStreamsService`) is mocked, since these routes
 * would otherwise need a live Postgres connection; the auth/admin middleware
 * chain, `adminFeatureGate`, and the route handlers themselves are real.
 */

jest.mock("../../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      const jsonwebtoken = require("jsonwebtoken");
      return jsonwebtoken.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

jest.mock("../../services/adminStreams.service", () => ({
  adminStreamsService: {
    list: jest.fn(),
    getByStreamId: jest.fn(),
  },
}));

jest.mock("../../services/streamClawback.service", () => {
  const activeClawbacks = new Set<string>();
  return {
    streamClawbackService: {
      acquire: (streamId: string) => {
        if (activeClawbacks.has(streamId)) throw new Error("already locked");
        activeClawbacks.add(streamId);
      },
      release: (streamId: string) => activeClawbacks.delete(streamId),
    },
  };
});

jest.mock("../../services/streamValidation.service", () => {
  const actual = jest.requireActual("../../services/streamValidation.service");
  return {
    ...actual,
    streamValidationService: {
      getStreamOrThrow: jest.fn().mockResolvedValue({ streamId: "stream-abc-123" }),
      requireActionableStream: jest.fn().mockResolvedValue({
        streamId: "stream-abc-123",
        status: "ACTIVE",
        vestingState: "vesting",
        unclaimed: "7500",
        pendingClawback: "0",
      }),
    },
  };
});

import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createApp } from "../../app";
import { adminStreamsService } from "../../services/adminStreams.service";

// Booting the real createApp() pulls in every route module (Stellar/Soroban
// clients, OpenTelemetry, etc.), so the first request through the full stack
// is slower than the default 5s test timeout even though later requests are
// fast.
jest.setTimeout(30000);

const JWT_SECRET = "test-jwt-secret-value-with-minimum-length-32";
const ADMIN_ADDRESS = "gadminintegration000000000000000000000000000000000000000";
const NON_ADMIN_ADDRESS = "guserintegration0000000000000000000000000000000000000000";

const mockList = adminStreamsService.list as jest.MockedFunction<typeof adminStreamsService.list>;
const mockGetByStreamId = adminStreamsService.getByStreamId as jest.MockedFunction<
  typeof adminStreamsService.getByStreamId
>;

function makeToken(walletAddress: string) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: walletAddress,
      walletAddress,
      jti: `jti-${walletAddress.slice(0, 8)}`,
      iss: "amana",
      aud: "amana-api",
      iat: now,
      nbf: now,
      exp: now + 86400,
    },
    JWT_SECRET,
    { algorithm: "HS256" },
  );
}

describe("adminAuth — full-app integration (#53)", () => {
  let app: express.Application;

  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.ADMIN_ROUTES_ENABLED = "true";
    process.env.ADMIN_STELLAR_PUBKEYS = ADMIN_ADDRESS;
    app = createApp();
  });

  afterAll(() => {
    delete process.env.ADMIN_ROUTES_ENABLED;
    delete process.env.ADMIN_STELLAR_PUBKEYS;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/admin/streams", () => {
    it("rejects a non-admin caller with 403 from the real adminMiddleware", async () => {
      const token = makeToken(NON_ADMIN_ADDRESS);

      const res = await request(app).get("/api/admin/streams").set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual(
        expect.objectContaining({ error: "Forbidden: admin access required" }),
      );
      expect(mockList).not.toHaveBeenCalled();
    });

    it("rejects an unauthenticated caller with 401 before reaching the route handler", async () => {
      const res = await request(app).get("/api/admin/streams");

      expect(res.status).toBe(401);
      expect(mockList).not.toHaveBeenCalled();
    });

    it("lets an admin caller reach the real route handler", async () => {
      mockList.mockResolvedValueOnce({
        items: [
          {
            streamId: "stream-abc-123",
            recipient: "GRECIPIENT000000000000000000000000000000000000000000000",
            status: "ACTIVE",
            vestingState: "vesting",
            totalVested: "10000",
            claimed: "2500",
            unclaimed: "7500",
            pendingClawback: "0",
            adminTags: [],
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
            updatedAt: new Date("2026-07-05T00:00:00.000Z"),
          },
        ],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
      const token = makeToken(ADMIN_ADDRESS);

      const res = await request(app).get("/api/admin/streams").set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].streamId).toBe("stream-abc-123");
      expect(mockList).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST /api/admin/streams/:id/clawback/preview", () => {
    it("rejects a non-admin caller with 403 before touching the clawback service", async () => {
      const token = makeToken(NON_ADMIN_ADDRESS);

      const res = await request(app)
        .post("/api/admin/streams/stream-abc-123/clawback/preview")
        .set("Authorization", `Bearer ${token}`)
        .send({ amount: "1000" });

      expect(res.status).toBe(403);
      expect(mockGetByStreamId).not.toHaveBeenCalled();
    });

    it("lets an admin caller reach the real clawback preview handler", async () => {
      mockGetByStreamId.mockResolvedValueOnce({
        streamId: "stream-abc-123",
        unclaimed: "7500",
      } as never);
      const token = makeToken(ADMIN_ADDRESS);

      const res = await request(app)
        .post("/api/admin/streams/stream-abc-123/clawback/preview")
        .set("Authorization", `Bearer ${token}`)
        .send({ amount: "1000" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        streamId: "stream-abc-123",
        remainingVested: "7500",
        requestedClawback: "1000",
        postClawbackBalance: "6500",
        preview: true,
      });
    });
  });
});

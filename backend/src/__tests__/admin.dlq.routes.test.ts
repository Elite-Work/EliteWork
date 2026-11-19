process.env.JWT_SECRET = "test-secret-at-least-32-characters-long!!";
process.env.JWT_ISSUER = "amana";
process.env.JWT_AUDIENCE = "amana-api";
process.env.DATABASE_URL = "postgresql://localhost:5432/amana_test";
process.env.AMANA_ESCROW_CONTRACT_ID =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
process.env.USDC_CONTRACT_ID =
  "CBIELTK6YBZJU5UP2WWQEUCY7PUJE7R6OB3NIUJKL5UH4WJQJ6HVHKX";

import crypto from "crypto";
import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";

const mockGetJobs = jest.fn();
const mockCount = jest.fn();
const mockGetJob = jest.fn();
const mockWebhookQueueAdd = jest.fn();
const mockIsTokenRevoked = jest.fn();

jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      const verified = jwt.verify(token, process.env.JWT_SECRET!, {
        algorithms: ["HS256"],
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
      });
      return verified;
    }),
    isTokenRevoked: (...args: unknown[]) => mockIsTokenRevoked(...args),
    getTokenVersion: jest.fn().mockResolvedValue(0),
  },
}));

jest.mock("../jobs/deadLetter", () => ({
  getDeadLetterQueue: jest.fn(() => ({
    getJobs: (...args: unknown[]) => mockGetJobs(...args),
    count: (...args: unknown[]) => mockCount(...args),
    getJob: (...args: unknown[]) => mockGetJob(...args),
  })),
}));

jest.mock("../jobs/queue", () => ({
  webhookQueue: { add: (...args: unknown[]) => mockWebhookQueueAdd(...args) },
  notificationQueue: { add: jest.fn() },
  exportQueue: { add: jest.fn() },
  tradeExpiryQueue: { add: jest.fn() },
  reconciliationQueue: { add: jest.fn() },
}));

import { createAdminDlqRouter, hashDlqPayload } from "../routes/admin.dlq.routes";
import { errorHandler } from "../middleware/errorHandler";

const adminAddress = StellarSdk.Keypair.random().publicKey();
const nonAdminAddress = StellarSdk.Keypair.random().publicKey();

function signToken(walletAddress: string, expiresInSeconds = 3600): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      walletAddress,
      jti: `jti-${walletAddress}-${Math.random()}`,
      iss: process.env.JWT_ISSUER,
      aud: process.env.JWT_AUDIENCE,
      iat: now,
      exp: now + expiresInSeconds,
    },
    process.env.JWT_SECRET!,
    { algorithm: "HS256" },
  );
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createAdminDlqRouter());
  app.use(errorHandler);
  return app;
}

describe("admin.dlq.routes", () => {
  let app: express.Express;

  beforeAll(() => {
    process.env.ADMIN_STELLAR_PUBKEYS = adminAddress;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsTokenRevoked.mockResolvedValue(false);
    app = buildApp();
  });

  describe("GET /api/admin/dlq", () => {
    it("returns failed webhook event summaries with eventId, payloadHash, failureReason, and retryCount", async () => {
      const payload = { tradeId: "trade-99", status: "FUNDED", amount: "250" };
      const expectedHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex");

      mockGetJobs.mockResolvedValue([
        {
          id: "dlq-101",
          data: {
            originalQueue: "webhooks",
            jobName: "dispatch",
            data: payload,
            attemptsMade: 3,
            errorClass: "Error",
            errorMessage: "Webhook delivery returned HTTP 503",
            failedAt: "2026-11-19T10:00:00.000Z",
          },
        },
      ]);
      mockCount.mockResolvedValue(1);

      const res = await request(app)
        .get("/api/admin/dlq")
        .set("Authorization", `Bearer ${signToken(adminAddress)}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        queue: "webhooks",
        depth: 1,
        page: 1,
        limit: 50,
        events: [
          {
            eventId: "dlq-101",
            queue: "webhooks",
            jobName: "dispatch",
            payloadHash: expectedHash,
            failureReason: "Webhook delivery returned HTTP 503",
            errorClass: "Error",
            retryCount: 3,
            failedAt: "2026-11-19T10:00:00.000Z",
          },
        ],
      });
      expect(hashDlqPayload(payload)).toBe(expectedHash);
      expect(mockGetJobs).toHaveBeenCalledWith(["waiting", "delayed", "active"], 0, 49);
    });

    it("supports custom queue, page, and limit query parameters", async () => {
      mockGetJobs.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      const res = await request(app)
        .get("/api/admin/dlq")
        .query({ queue: "notifications", page: "2", limit: "10" })
        .set("Authorization", `Bearer ${signToken(adminAddress)}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        queue: "notifications",
        depth: 0,
        page: 2,
        limit: 10,
        events: [],
      });
      expect(mockGetJobs).toHaveBeenCalledWith(["waiting", "delayed", "active"], 10, 19);
    });

    it("returns 404 for an unknown queue", async () => {
      const res = await request(app)
        .get("/api/admin/dlq")
        .query({ queue: "does-not-exist" })
        .set("Authorization", `Bearer ${signToken(adminAddress)}`);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Unknown queue" });
    });

    it("returns 400 on invalid query params", async () => {
      const res = await request(app)
        .get("/api/admin/dlq")
        .query({ limit: "not-a-number" })
        .set("Authorization", `Bearer ${signToken(adminAddress)}`);

      expect(res.status).toBe(400);
      expect(mockGetJobs).not.toHaveBeenCalled();
    });

    it("returns 401 when unauthenticated (no token)", async () => {
      const res = await request(app).get("/api/admin/dlq");
      expect(res.status).toBe(401);
    });

    it("returns 401 for a malformed token", async () => {
      const res = await request(app)
        .get("/api/admin/dlq")
        .set("Authorization", "Bearer malformed.token");
      expect(res.status).toBe(401);
    });

    it("returns 401 for an expired token", async () => {
      const res = await request(app)
        .get("/api/admin/dlq")
        .set("Authorization", `Bearer ${signToken(adminAddress, -60)}`);
      expect(res.status).toBe(401);
    });

    it("returns 401 for a revoked session", async () => {
      mockIsTokenRevoked.mockResolvedValue(true);
      const res = await request(app)
        .get("/api/admin/dlq")
        .set("Authorization", `Bearer ${signToken(adminAddress)}`);
      expect(res.status).toBe(401);
    });

    it("returns 403 for a valid non-admin wallet", async () => {
      const res = await request(app)
        .get("/api/admin/dlq")
        .set("Authorization", `Bearer ${signToken(nonAdminAddress)}`);
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/admin/dlq/:queue", () => {
    it("returns raw dead-letter jobs for a known queue", async () => {
      mockGetJobs.mockResolvedValue([
        {
          id: "job-1",
          data: {
            originalQueue: "webhooks",
            jobName: "dispatch",
            data: { tradeId: "t-1" },
            attemptsMade: 3,
            errorClass: "Error",
            errorMessage: "Timeout",
            failedAt: "2026-11-19T10:00:00.000Z",
          },
        },
      ]);
      mockCount.mockResolvedValue(1);

      const res = await request(app)
        .get("/api/admin/dlq/webhooks")
        .set("Authorization", `Bearer ${signToken(adminAddress)}`);

      expect(res.status).toBe(200);
      expect(res.body.queue).toBe("webhooks");
      expect(res.body.depth).toBe(1);
      expect(res.body.jobs).toHaveLength(1);
      expect(res.body.jobs[0].id).toBe("job-1");
    });

    it("returns 404 for unknown queue", async () => {
      const res = await request(app)
        .get("/api/admin/dlq/unknown")
        .set("Authorization", `Bearer ${signToken(adminAddress)}`);
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/admin/dlq/:queue/:jobId/replay", () => {
    it("replays a dead-letter job and removes it from the DLQ", async () => {
      const remove = jest.fn().mockResolvedValue(undefined);
      mockGetJob.mockResolvedValue({
        id: "dlq-101",
        data: {
          jobName: "dispatch",
          data: { tradeId: "trade-99" },
        },
        remove,
      });
      mockWebhookQueueAdd.mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/admin/dlq/webhooks/dlq-101/replay")
        .set("Authorization", `Bearer ${signToken(adminAddress)}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        queue: "webhooks",
        replayedJobId: "dlq-101",
      });
      expect(mockWebhookQueueAdd).toHaveBeenCalledWith("dispatch", { tradeId: "trade-99" });
      expect(remove).toHaveBeenCalledTimes(1);
    });

    it("returns 404 when the dead-letter job does not exist", async () => {
      mockGetJob.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/admin/dlq/webhooks/missing/replay")
        .set("Authorization", `Bearer ${signToken(adminAddress)}`);

      expect(res.status).toBe(404);
    });
  });
});

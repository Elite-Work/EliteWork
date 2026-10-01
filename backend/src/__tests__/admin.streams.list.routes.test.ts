/**
 * Admin stream list — GET /api/admin/streams (#51).
 *
 * Covers admin protection and that pagination/status/vestingState/adminTag
 * query params reach the service correctly. Prisma is injected as a fake, so
 * nothing here needs a database.
 */

jest.mock("../config/env", () => ({
  env: { NODE_ENV: "test", JWT_SECRET: "test-jwt-secret-value-with-minimum-length-32" },
  runtimeEnvValue: (key: string) => process.env[key] ?? false,
}));

jest.mock("../config/rateLimit", () => ({
  RATE_LIMIT_CONFIG: {
    admin: { windowMs: 60_000, max: 1_000, message: "Too many admin requests" },
  },
}));

jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      const jsonwebtoken = require("jsonwebtoken");
      return jsonwebtoken.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

const mockIsMediatorAddress = jest.fn();
jest.mock("../lib/accessControl", () => ({
  isMediatorAddress: (address: string) => mockIsMediatorAddress(address),
}));

import express, { Express } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { StreamStatus } from "@prisma/client";

import { createAdminStreamsRouter } from "../routes/admin.streams.routes";
import { StreamTerminationService } from "../services/streamTermination.service";
import { AdminStreamsService } from "../services/adminStreams.service";
import { errorHandler } from "../middleware/errorHandler";

const JWT_SECRET = "test-jwt-secret-value-with-minimum-length-32";
const ADMIN_ADDRESS = "GADMIN000000000000000000000000000000000000000000000000";
const USER_ADDRESS = "GUSER0000000000000000000000000000000000000000000000000";

function makeStream(overrides: Record<string, unknown> = {}) {
  return {
    streamId: "stream-1",
    recipient: "GRECIPIENT000000000000000000000000000000000000000000",
    totalVested: "10000",
    claimed: "0",
    unclaimed: "10000",
    pendingClawback: "0",
    status: StreamStatus.ACTIVE,
    adminTags: [],
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma(streams: ReturnType<typeof makeStream>[]) {
  return {
    stream: {
      findMany: jest.fn(async () => streams),
      findUnique: jest.fn(async () => null),
    },
  };
}

function tokenFor(walletAddress: string): string {
  return jwt.sign({ walletAddress, tokenId: "test-token-id" }, JWT_SECRET, { expiresIn: "1h" });
}

function buildApp(streamsService: AdminStreamsService): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAdminStreamsRouter(new StreamTerminationService({} as never), undefined, streamsService),
  );
  app.use(errorHandler);
  return app;
}

describe("GET /api/admin/streams", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsMediatorAddress.mockImplementation((address: string) => address === ADMIN_ADDRESS);
  });

  describe("admin protection", () => {
    it("rejects a request with no bearer token (401)", async () => {
      const prisma = makePrisma([]);
      const app = buildApp(new AdminStreamsService(prisma as never));

      const res = await request(app).get("/api/admin/streams");

      expect(res.status).toBe(401);
      expect(prisma.stream.findMany).not.toHaveBeenCalled();
    });

    it("rejects an authenticated non-admin caller (403)", async () => {
      const prisma = makePrisma([]);
      const app = buildApp(new AdminStreamsService(prisma as never));

      const res = await request(app)
        .get("/api/admin/streams")
        .set("Authorization", `Bearer ${tokenFor(USER_ADDRESS)}`);

      expect(res.status).toBe(403);
      expect(prisma.stream.findMany).not.toHaveBeenCalled();
    });
  });

  describe("listing", () => {
    it("returns paginated stream summaries for an admin caller", async () => {
      const prisma = makePrisma([makeStream({ streamId: "s1" }), makeStream({ streamId: "s2" })]);
      const app = buildApp(new AdminStreamsService(prisma as never));

      const res = await request(app)
        .get("/api/admin/streams")
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
    });

    it("forwards status, vestingState and adminTag filters plus pagination to the service", async () => {
      const prisma = makePrisma([]);
      const app = buildApp(new AdminStreamsService(prisma as never));

      await request(app)
        .get("/api/admin/streams")
        .query({ page: "2", limit: "5", status: "SUSPENDED", vestingState: "vesting", adminTag: "legal-hold" })
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`);

      expect(prisma.stream.findMany).toHaveBeenCalledWith({
        where: { status: StreamStatus.SUSPENDED, adminTags: { has: "legal-hold" } },
        orderBy: { createdAt: "desc" },
      });
    });

    it("rejects an invalid status filter (400)", async () => {
      const prisma = makePrisma([]);
      const app = buildApp(new AdminStreamsService(prisma as never));

      const res = await request(app)
        .get("/api/admin/streams")
        .query({ status: "NOT_A_REAL_STATUS" })
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`);

      expect(res.status).toBe(400);
      expect(prisma.stream.findMany).not.toHaveBeenCalled();
    });

    it("rejects a limit above 100 (400)", async () => {
      const prisma = makePrisma([]);
      const app = buildApp(new AdminStreamsService(prisma as never));

      const res = await request(app)
        .get("/api/admin/streams")
        .query({ limit: "500" })
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`);

      expect(res.status).toBe(400);
      expect(prisma.stream.findMany).not.toHaveBeenCalled();
    });
  });
});

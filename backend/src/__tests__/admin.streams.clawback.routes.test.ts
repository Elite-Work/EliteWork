/**
 * Admin stream clawback preview — POST /api/admin/streams/:id/clawback/preview.
 *
 * The preview route reads the stream's real remaining vested (unclaimed)
 * balance and rejects invalid/oversized amounts with the client-visible
 * `CLAWBACK_INVALID_AMOUNT` / `CLAWBACK_TOO_LARGE` error codes (#59) that the
 * frontend confirmation modal and amount validation (#56, #57) depend on.
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
import { StreamValidationService } from "../services/streamValidation.service";
import { errorHandler } from "../middleware/errorHandler";

const JWT_SECRET = "test-jwt-secret-value-with-minimum-length-32";
const ADMIN_ADDRESS = "GADMIN000000000000000000000000000000000000000000000000";
const USER_ADDRESS = "GUSER0000000000000000000000000000000000000000000000000";
const STREAM_ID = "stream-abc-123";

function makeStream(overrides: Record<string, unknown> = {}) {
  return {
    streamId: STREAM_ID,
    recipient: "GRECIPIENT000000000000000000000000000000000000000000",
    totalVested: "10000",
    claimed: "2500",
    unclaimed: "7500",
    pendingClawback: "0",
    status: StreamStatus.ACTIVE,
    adminTags: [],
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

function makePrisma(stream: ReturnType<typeof makeStream> | null) {
  return {
    stream: {
      findUnique: jest.fn(async ({ where }: { where: { streamId: string } }) =>
        stream && stream.streamId === where.streamId ? { ...stream } : null,
      ),
      findMany: jest.fn(async () => (stream ? [stream] : [])),
    },
  };
}

function tokenFor(walletAddress: string): string {
  return jwt.sign({ walletAddress, tokenId: "test-token-id" }, JWT_SECRET, { expiresIn: "1h" });
}

function buildApp(prisma: unknown): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAdminStreamsRouter(
      new StreamTerminationService({} as never),
      undefined,
      new AdminStreamsService(prisma as never),
      new StreamValidationService(prisma as never),
      { acquire: jest.fn(), release: jest.fn() },
    ),
  );
  app.use(errorHandler);
  return app;
}

describe("POST /api/admin/streams/:id/clawback/preview", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsMediatorAddress.mockImplementation((address: string) => address === ADMIN_ADDRESS);
  });

  describe("admin protection", () => {
    it("rejects a request with no bearer token (401)", async () => {
      const prisma = makePrisma(makeStream());
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/clawback/preview`)
        .send({ amount: "1000" });

      expect(res.status).toBe(401);
    });

    it("rejects an authenticated non-admin caller (403)", async () => {
      const prisma = makePrisma(makeStream());
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/clawback/preview`)
        .set("Authorization", `Bearer ${tokenFor(USER_ADDRESS)}`)
        .send({ amount: "1000" });

      expect(res.status).toBe(403);
      expect(prisma.stream.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("valid preview", () => {
    it("returns the real remaining vested amount and post-clawback balance", async () => {
      const prisma = makePrisma(makeStream({ unclaimed: "7500" }));
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/clawback/preview`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ amount: "3000" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        streamId: STREAM_ID,
        remainingVested: "7500",
        requestedClawback: "3000",
        postClawbackBalance: "4500",
        preview: true,
      });
    });

    it("allows a clawback of exactly the remaining vested amount", async () => {
      const prisma = makePrisma(makeStream({ unclaimed: "7500" }));
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/clawback/preview`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ amount: "7500" });

      expect(res.status).toBe(200);
      expect(res.body.postClawbackBalance).toBe("0");
    });
  });

  describe("invalid amount", () => {
    it("returns 404 CLAWBACK-unrelated NOT_FOUND for an unknown stream", async () => {
      const prisma = makePrisma(null);
      const app = buildApp(prisma);

      const res = await request(app)
        .post("/api/admin/streams/does-not-exist/clawback/preview")
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ amount: "1000" });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    });

    it("returns 400 CLAWBACK_TOO_LARGE when amount exceeds remaining vested", async () => {
      const prisma = makePrisma(makeStream({ unclaimed: "7500" }));
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/clawback/preview`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ amount: "7501" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("CLAWBACK_TOO_LARGE");
      expect(res.body.details).toMatchObject({ remainingVested: "7500" });
    });

    it("returns 400 CLAWBACK_INVALID_AMOUNT for a zero amount", async () => {
      const prisma = makePrisma(makeStream({ unclaimed: "7500" }));
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/clawback/preview`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ amount: "0" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("CLAWBACK_INVALID_AMOUNT");
    });

    it("rejects a negative amount before preview (schema or CLAWBACK_INVALID_AMOUNT)", async () => {
      const prisma = makePrisma(makeStream({ unclaimed: "7500" }));
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/clawback/preview`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ amount: "-1" });

      expect(res.status).toBe(400);
      // Zod `^\d+$` rejects signed amounts at the schema boundary
      // (VALIDATION_ERROR). If the handler is reached, map to
      // CLAWBACK_INVALID_AMOUNT.
      expect(["VALIDATION_ERROR", "CLAWBACK_INVALID_AMOUNT"]).toContain(
        res.body.code,
      );
      if (res.body.code === "VALIDATION_ERROR") {
        expect(prisma.stream.findUnique).not.toHaveBeenCalled();
      }
    });

    it("rejects a non-numeric amount at the schema level (400)", async () => {
      const prisma = makePrisma(makeStream());
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/clawback/preview`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ amount: "not-a-number" });

      expect(res.status).toBe(400);
      expect(prisma.stream.findUnique).not.toHaveBeenCalled();
    });
  });
});

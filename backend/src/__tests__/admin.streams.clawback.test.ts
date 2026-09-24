import express, { Express } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";

import { createAdminStreamsRouter } from "../routes/admin.streams.routes";
import { errorHandler } from "../middleware/errorHandler";
import { AppError, ErrorCode } from "../errors/errorCodes";
import { AdminStreamsService } from "../services/adminStreams.service";
import { StreamValidationService } from "../services/streamValidation.service";

/**
 * The clawback preview route validates the requested amount against the
 * stream's real `unclaimed` balance (#51/#59), so this concurrency suite
 * needs every stream id it exercises to resolve to a stream with plenty of
 * headroom — the assertions here are about locking, not amount validation.
 */
function fakeStreamsService(): AdminStreamsService {
  const prisma = {
    stream: {
      findUnique: jest.fn(async ({ where }: { where: { streamId: string } }) => ({
        streamId: where.streamId,
        recipient: "GRECIPIENT000000000000000000000000000000000000000000",
        totalVested: "1000000",
        claimed: "0",
        unclaimed: "1000000",
        pendingClawback: "0",
        status: "ACTIVE",
        adminTags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
  };
  return new AdminStreamsService(prisma as never);
}

function fakeValidationService(): StreamValidationService {
  const prisma = {
    stream: {
      findUnique: jest.fn(async ({ where }: { where: { streamId: string } }) => ({
        streamId: where.streamId,
        recipient: "GRECIPIENT000000000000000000000000000000000000000000",
        totalVested: "1000000",
        claimed: "0",
        unclaimed: "1000000",
        pendingClawback: "0",
        status: "ACTIVE",
        adminTags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
  };
  return new StreamValidationService(prisma as never);
}

jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      const jsonwebtoken = require("jsonwebtoken");
      return jsonwebtoken.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

const adminAddress = StellarSdk.Keypair.random().publicKey();
const testLocks = new Set<string>();
const testClawbackService = {
  acquire(streamId: string): void {
    if (testLocks.has(streamId)) {
      throw new AppError(
        ErrorCode.DOMAIN_ERROR,
        `A clawback operation is already in progress for stream ${streamId}`,
        409,
        { streamId },
      );
    }
    testLocks.add(streamId);
  },
  release(streamId: string): void {
    testLocks.delete(streamId);
  },
};

function signToken(walletAddress: string): string {
  const secret = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { walletAddress, jti: "clawback-test", iss: "amana", aud: "amana-api", nbf: now - 1 },
    secret,
    { algorithm: "HS256" },
  );
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAdminStreamsRouter(
      undefined,
      undefined,
      fakeStreamsService(),
      fakeValidationService(),
      testClawbackService,
    ),
  );
  app.use(errorHandler);
  return app;
}

describe("concurrent stream clawback prevention (#14)", () => {
  let app: Express;
  let adminToken: string;

  beforeAll(() => {
    process.env.ADMIN_STELLAR_PUBKEYS = adminAddress;
    adminToken = signToken(adminAddress);
  });

  beforeEach(() => {
    testLocks.clear();
    app = buildApp();
  });

  it("succeeds for a single clawback request", async () => {
    const res = await request(app)
      .post("/api/admin/streams/stream-1/clawback/preview")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "500" });

    expect(res.status).toBe(200);
    expect(res.body.streamId).toBe("stream-1");
    expect(res.body.requestedClawback).toBe("500");
    expect(res.body.preview).toBe(true);
  });

  it("rejects a concurrent clawback on the same stream with 409", async () => {
    testClawbackService.acquire("stream-race");

    try {
      const res = await request(app)
        .post("/api/admin/streams/stream-race/clawback/preview")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ amount: "200" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("DOMAIN_ERROR");
      expect(res.body.message).toMatch(/already in progress/i);
    } finally {
      testClawbackService.release("stream-race");
    }
  });

  it("allows clawback on different streams concurrently", async () => {
    testClawbackService.acquire("stream-a");

    try {
      const res = await request(app)
        .post("/api/admin/streams/stream-b/clawback/preview")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ amount: "100" });

      expect(res.status).toBe(200);
      expect(res.body.streamId).toBe("stream-b");
    } finally {
      testClawbackService.release("stream-a");
    }
  });

  it("releases the lock after a successful clawback so a follow-up succeeds", async () => {
    const res1 = await request(app)
      .post("/api/admin/streams/stream-c/clawback/preview")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "100" });
    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .post("/api/admin/streams/stream-c/clawback/preview")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "200" });
    expect(res2.status).toBe(200);
  });

  it("returns standardized error shape on concurrent conflict", async () => {
    testClawbackService.acquire("stream-shape");

    try {
      const res = await request(app)
        .post("/api/admin/streams/stream-shape/clawback/preview")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ amount: "100" });

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty("code");
      expect(res.body).toHaveProperty("message");
      expect(res.body).toHaveProperty("details");
      expect(res.body.details.streamId).toBe("stream-shape");
    } finally {
      testClawbackService.release("stream-shape");
    }
  });
});

/**
 * Admin stream termination — POST /api/admin/streams/:id/terminate (#24).
 *
 * Covers admin protection, state validation, the contract/backend trigger and
 * the audit write. Prisma and the Soroban signer are injected as fakes, and the
 * env/rate-limit config modules are mocked, so nothing here needs a database,
 * an admin keypair or Redis — a failure points at the route or the termination
 * rules, not at infrastructure.
 */

jest.mock("../config/env", () => ({
  env: {
    NODE_ENV: "test",
    JWT_SECRET: "test-jwt-secret-value-with-minimum-length-32",
  },
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

jest.mock("../services/adminNotification.service", () => ({
  AdminNotificationService: class {},
  AdminNotificationEvents: {},
  extractErrorInfo: (error: unknown) => {
    if (error && typeof error === "object") {
      const err = error as Record<string, unknown>;
      return {
        message: typeof err.message === "string" ? err.message : String(error),
        code: typeof err.code === "string" ? err.code : undefined,
        details: typeof err.details === "object" && err.details !== null ? err.details : undefined,
      };
    }
    return { message: String(error) };
  },
  adminNotificationService: {
    notifyStreamLocked: jest.fn(),
    notifyStreamUnlocked: jest.fn(),
    notifyStreamTerminated: jest.fn(),
    notifyOperationFailed: jest.fn(),
    onSuccess: jest.fn(),
    onFailure: jest.fn(),
    removeAllListeners: jest.fn(),
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
import { StreamLockService } from "../services/streamLock.service";
import { StreamValidationService } from "../services/streamValidation.service";
import {
  ADMIN_ACTION_STREAM_TERMINATE,
  StreamTerminationService,
  CacheInvalidator,
} from "../services/streamTermination.service";
import { errorHandler } from "../middleware/errorHandler";
import { adminNotificationService } from "../services/adminNotification.service";

const notifyStreamTerminatedMock = adminNotificationService.notifyStreamTerminated as jest.Mock;
const notifyOperationFailedMock = adminNotificationService.notifyOperationFailed as jest.Mock;

const JWT_SECRET = "test-jwt-secret-value-with-minimum-length-32";
const ADMIN_ADDRESS = "GADMIN000000000000000000000000000000000000000000000000";
const USER_ADDRESS = "GUSER0000000000000000000000000000000000000000000000000";
const STREAM_ID = "stream-abc-123";

type StreamRecord = {
  streamId: string;
  recipient: string;
  totalVested: string;
  claimed: string;
  unclaimed: string;
  pendingClawback: string;
  status: StreamStatus;
  terminatedAt: Date | null;
  terminatedBy: string | null;
  terminationReason: string | null;
};

function makeStream(overrides: Partial<StreamRecord> = {}): StreamRecord {
  return {
    streamId: STREAM_ID,
    recipient: "GRECIPIENT000000000000000000000000000000000000000000",
    totalVested: "10000",
    claimed: "2500",
    unclaimed: "7500",
    pendingClawback: "0",
    status: StreamStatus.ACTIVE,
    terminatedAt: null,
    terminatedBy: null,
    terminationReason: null,
    ...overrides,
  };
}

/** In-memory stand-in for the two Prisma delegates the service touches. */
function makePrisma(stream: StreamRecord | null) {
  let current = stream;

  return {
    stream: {
      findUnique: jest.fn(async ({ where }: { where: { streamId: string } }) =>
        current && current.streamId === where.streamId ? { ...current } : null,
      ),
      update: jest.fn(
        async ({
          data,
        }: {
          where: { streamId: string };
          data: Partial<StreamRecord>;
        }) => {
          current = { ...(current as StreamRecord), ...data };
          return { ...current };
        },
      ),
    },
    adminActionAudit: {
      create: jest.fn(async (args: unknown) => args),
    },
  };
}

function tokenFor(walletAddress: string): string {
  return jwt.sign({ walletAddress, tokenId: "test-token-id" }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

const noopCacheInvalidator: CacheInvalidator = jest.fn().mockResolvedValue(undefined);

function buildApp(
  prismaMock: unknown,
  signer?: (xdr: string) => string,
): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAdminStreamsRouter(
      new StreamTerminationService(prismaMock as never, signer, undefined, noopCacheInvalidator),
      new StreamLockService(prismaMock as never),
      undefined,
      new StreamValidationService(prismaMock as never),
    ),
  );
  app.use(errorHandler);
  return app;
}

describe("POST /api/admin/streams/:id/terminate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsMediatorAddress.mockImplementation(
      (address: string) => address === ADMIN_ADDRESS,
    );
  });

  // ── Admin protection ────────────────────────────────────────────────────

  describe("admin protection", () => {
    it("rejects a request with no bearer token (401)", async () => {
      const prisma = makePrisma(makeStream());
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .send({});

      expect(res.status).toBe(401);
      expect(prisma.stream.update).not.toHaveBeenCalled();
    });

    it("rejects a malformed bearer token (401)", async () => {
      const prisma = makePrisma(makeStream());
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", "Bearer not-a-jwt")
        .send({});

      expect(res.status).toBe(401);
      expect(prisma.stream.update).not.toHaveBeenCalled();
    });

    it("rejects an authenticated non-admin caller (403)", async () => {
      const prisma = makePrisma(makeStream());
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", `Bearer ${tokenFor(USER_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(403);
      expect(prisma.stream.findUnique).not.toHaveBeenCalled();
      expect(prisma.stream.update).not.toHaveBeenCalled();
    });
  });

  // ── Valid termination ───────────────────────────────────────────────────

  describe("valid termination", () => {
    it("terminates an ACTIVE stream and records who did it", async () => {
      const prisma = makePrisma(makeStream());
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ reason: "Recipient offboarded" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        streamId: STREAM_ID,
        status: StreamStatus.TERMINATED,
        previousStatus: StreamStatus.ACTIVE,
        terminatedBy: ADMIN_ADDRESS,
        reason: "Recipient offboarded",
        reversible: false,
        unclaimed: "7500",
      });
      expect(typeof res.body.terminatedAt).toBe("string");

      expect(prisma.stream.update).toHaveBeenCalledTimes(1);
      const updateArgs = prisma.stream.update.mock.calls[0][0] as {
        where: { streamId: string };
        data: Partial<StreamRecord>;
      };
      expect(updateArgs.where).toEqual({ streamId: STREAM_ID });
      expect(updateArgs.data.status).toBe(StreamStatus.TERMINATED);
      expect(updateArgs.data.terminatedBy).toBe(ADMIN_ADDRESS);
      expect(updateArgs.data.terminatedAt).toBeInstanceOf(Date);
    });

    it("terminates a SUSPENDED stream", async () => {
      const prisma = makePrisma(makeStream({ status: StreamStatus.SUSPENDED }));
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.previousStatus).toBe(StreamStatus.SUSPENDED);
      expect(res.body.status).toBe(StreamStatus.TERMINATED);
      expect(res.body.reason).toBeNull();
    });

    it("writes an admin audit record for the termination", async () => {
      const prisma = makePrisma(makeStream());
      const app = buildApp(prisma);

      await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ reason: "Fraud investigation" });

      expect(prisma.adminActionAudit.create).toHaveBeenCalledWith({
        data: {
          action: ADMIN_ACTION_STREAM_TERMINATE,
          actorAddress: ADMIN_ADDRESS,
          targetReference: STREAM_ID,
          note: "Fraud investigation",
        },
      });
    });

    it("emits a notification on successful termination", async () => {
      const prisma = makePrisma(makeStream());
      const app = buildApp(prisma);

      await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ reason: "Recipient offboarded" });

      expect(notifyStreamTerminatedMock).toHaveBeenCalledTimes(1);
      expect(notifyStreamTerminatedMock).toHaveBeenCalledWith({
        streamId: STREAM_ID,
        adminAddress: ADMIN_ADDRESS,
        reason: "Recipient offboarded",
        previousStatus: StreamStatus.ACTIVE,
        terminatedAt: expect.any(String),
        unclaimed: "7500",
      });
      expect(notifyOperationFailedMock).not.toHaveBeenCalled();
    });

    it("signs the supplied contract transaction and returns it", async () => {
      const prisma = makePrisma(makeStream());
      const signer = jest.fn().mockReturnValue("SIGNED_XDR");
      const app = buildApp(prisma, signer);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ unsignedTxXdr: "UNSIGNED_XDR" });

      expect(res.status).toBe(200);
      expect(signer).toHaveBeenCalledWith("UNSIGNED_XDR");
      expect(res.body.signedTxXdr).toBe("SIGNED_XDR");
    });

    it("performs the backend transition with no signer when no XDR is supplied", async () => {
      const prisma = makePrisma(makeStream());
      const signer = jest.fn();
      const app = buildApp(prisma, signer);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(200);
      expect(signer).not.toHaveBeenCalled();
      expect(res.body.signedTxXdr).toBeNull();
      expect(prisma.stream.update).toHaveBeenCalledTimes(1);
    });
  });

  // ── Invalid state ───────────────────────────────────────────────────────

  describe("invalid state", () => {
    it("returns 404 for an unknown stream and writes nothing", async () => {
      const prisma = makePrisma(null);
      const app = buildApp(prisma);

      const res = await request(app)
        .post("/api/admin/streams/does-not-exist/terminate")
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(404);
      expect(prisma.stream.update).not.toHaveBeenCalled();
      expect(prisma.adminActionAudit.create).not.toHaveBeenCalled();
    });

    it("emits a failure notification when terminate stream not found", async () => {
      const prisma = makePrisma(null);
      const app = buildApp(prisma);

      await request(app)
        .post("/api/admin/streams/does-not-exist/terminate")
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(notifyOperationFailedMock).toHaveBeenCalledTimes(1);
      const call = notifyOperationFailedMock.mock.calls[0][0];
      expect(call.streamId).toBe("does-not-exist");
      expect(call.action).toBe(ADMIN_ACTION_STREAM_TERMINATE);
      expect(call.error.message).toContain("not found");
    });

    it("emits a failure notification when stream is in non-terminable state", async () => {
      const prisma = makePrisma(makeStream({ status: StreamStatus.TERMINATED }));
      const app = buildApp(prisma);

      await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(notifyOperationFailedMock).toHaveBeenCalledTimes(1);
      const call = notifyOperationFailedMock.mock.calls[0][0];
      expect(call.streamId).toBe(STREAM_ID);
      expect(call.action).toBe(ADMIN_ACTION_STREAM_TERMINATE);
      expect(call.error.message).toContain("cannot be terminated");
    });

    it("returns 409 when the stream is already TERMINATED", async () => {
      const prisma = makePrisma(
        makeStream({
          status: StreamStatus.TERMINATED,
          terminatedAt: new Date("2026-01-01T00:00:00.000Z"),
          terminatedBy: ADMIN_ADDRESS,
        }),
      );
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(409);
      expect(prisma.stream.update).not.toHaveBeenCalled();
      expect(prisma.adminActionAudit.create).not.toHaveBeenCalled();
    });

    it("returns 409 when the stream is COMPLETED", async () => {
      const prisma = makePrisma(makeStream({ status: StreamStatus.COMPLETED }));
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(409);
      expect(prisma.stream.update).not.toHaveBeenCalled();
    });

    it("validates state before signing, so a rejected termination signs nothing", async () => {
      const prisma = makePrisma(
        makeStream({ status: StreamStatus.TERMINATED }),
      );
      const signer = jest.fn().mockReturnValue("SIGNED_XDR");
      const app = buildApp(prisma, signer);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ unsignedTxXdr: "UNSIGNED_XDR" });

      expect(res.status).toBe(409);
      expect(signer).not.toHaveBeenCalled();
    });

    it("leaves the stream live when signing fails", async () => {
      const prisma = makePrisma(makeStream());
      const signer = jest.fn(() => {
        throw new Error("Invalid unsigned transaction XDR.");
      });
      const app = buildApp(prisma, signer);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ unsignedTxXdr: "GARBAGE" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("SUBMISSION_VALIDATION_ERROR");
      expect(prisma.stream.update).not.toHaveBeenCalled();
      expect(prisma.adminActionAudit.create).not.toHaveBeenCalled();
    });

    it("rejects a second termination of the same stream (409 on replay)", async () => {
      const prisma = makePrisma(makeStream());
      const app = buildApp(prisma);
      const auth = `Bearer ${tokenFor(ADMIN_ADDRESS)}`;

      const first = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", auth)
        .send({});
      const second = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", auth)
        .send({});

      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
      expect(prisma.stream.update).toHaveBeenCalledTimes(1);
      expect(prisma.adminActionAudit.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── Payload validation ──────────────────────────────────────────────────

  describe("payload validation", () => {
    it("rejects a non-string reason (400)", async () => {
      const prisma = makePrisma(makeStream());
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ reason: 42 });

      expect(res.status).toBe(400);
      expect(prisma.stream.update).not.toHaveBeenCalled();
    });

    it("rejects a reason longer than 500 characters (400)", async () => {
      const prisma = makePrisma(makeStream());
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ reason: "x".repeat(501) });

      expect(res.status).toBe(400);
      expect(prisma.stream.update).not.toHaveBeenCalled();
    });
  });
});

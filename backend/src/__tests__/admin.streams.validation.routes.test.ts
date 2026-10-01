/**
 * Shared stream ownership & state validation (#33).
 *
 * Clawback and maintenance routes must reject unknown stream IDs with 404,
 * actions that are illegal in the stream's current lifecycle with 409, and
 * mutations against a stream locked for maintenance with 409 — all via the
 * shared StreamValidationService. These suites cover non-existent streams,
 * invalid lifecycle transitions, and valid transitions for suspend, resume,
 * clawback preview and terminate.
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
import {
  CacheInvalidator,
  StreamTerminationService,
} from "../services/streamTermination.service";
import { StreamLockService } from "../services/streamLock.service";
import { StreamValidationService } from "../services/streamValidation.service";
import { errorHandler } from "../middleware/errorHandler";

const noopCacheInvalidator: CacheInvalidator = jest.fn().mockResolvedValue(undefined);

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
  lockedAt: Date | null;
  lockedBy: string | null;
  lockReason: string | null;
  adminTags: string[];
  createdAt: Date;
  updatedAt: Date;
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
    lockedAt: null,
    lockedBy: null,
    lockReason: null,
    adminTags: [],
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

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
      findMany: jest.fn(async () => (current ? [current] : [])),
    },
    adminActionAudit: {
      create: jest.fn(async (args: unknown) => args),
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
      new StreamTerminationService(prisma as never, undefined, undefined, noopCacheInvalidator),
      new StreamLockService(prisma as never),
      undefined,
      new StreamValidationService(prisma as never),
      { acquire: jest.fn(), release: jest.fn() },
    ),
  );
  app.use(errorHandler);
  return app;
}

describe("shared stream ownership & state validation (#33)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsMediatorAddress.mockImplementation((address: string) => address === ADMIN_ADDRESS);
  });

  // ── Non-existent stream → 404 ──────────────────────────────────────────

  describe("non-existent streams return 404", () => {
    it.each([
      ["suspend", "/suspend"],
      ["resume", "/resume"],
      ["clawback preview", "/clawback/preview"],
      ["terminate", "/terminate"],
      ["lock", "/lock"],
      ["unlock", "/unlock"],
    ])("rejects %s on an unknown stream with 404", async (_label, path) => {
      const prisma = makePrisma(null);
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/does-not-exist${path}`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send(path === "/clawback/preview" ? { amount: "100" } : {});

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
      expect(prisma.stream.update).not.toHaveBeenCalled();
    });
  });

  // ── Invalid lifecycle state → 409 ──────────────────────────────────────

  describe("actions invalid in current state return 409", () => {
    it("rejects clawback preview on a TERMINATED stream with 409", async () => {
      const prisma = makePrisma(makeStream({ status: StreamStatus.TERMINATED }));
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/clawback/preview`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ amount: "100" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("DOMAIN_ERROR");
      expect(res.body.details.status).toBe(StreamStatus.TERMINATED);
    });

    it("rejects clawback preview on a COMPLETED stream with 409", async () => {
      const prisma = makePrisma(makeStream({ status: StreamStatus.COMPLETED }));
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/clawback/preview`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ amount: "100" });

      expect(res.status).toBe(409);
    });

    it("rejects suspending an already-SUSPENDED stream with 409", async () => {
      const prisma = makePrisma(makeStream({ status: StreamStatus.SUSPENDED }));
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/suspend`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("DOMAIN_ERROR");
    });

    it("rejects suspending a TERMINATED stream with 409", async () => {
      const prisma = makePrisma(makeStream({ status: StreamStatus.TERMINATED }));
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/suspend`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(409);
    });

    it("rejects resuming an ACTIVE stream with 409", async () => {
      const prisma = makePrisma(makeStream({ status: StreamStatus.ACTIVE }));
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/resume`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(409);
    });

    it("rejects mutating a stream locked for maintenance with 409", async () => {
      const prisma = makePrisma(
        makeStream({
          lockedAt: new Date("2026-07-30T10:00:00.000Z"),
          lockedBy: ADMIN_ADDRESS,
          lockReason: "Maintenance",
        }),
      );
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/clawback/preview`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ amount: "100" });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/locked for maintenance/i);
      expect(res.body.details.lockedBy).toBe(ADMIN_ADDRESS);
    });
  });

  // ── Valid transitions ──────────────────────────────────────────────────

  describe("valid transitions succeed", () => {
    it("allows clawback preview on a live ACTIVE stream", async () => {
      const prisma = makePrisma(makeStream());
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/clawback/preview`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ amount: "1000" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ streamId: STREAM_ID, preview: true });
    });

    it("allows clawback preview on a SUSPENDED stream", async () => {
      const prisma = makePrisma(makeStream({ status: StreamStatus.SUSPENDED }));
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/clawback/preview`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ amount: "1000" });

      expect(res.status).toBe(200);
    });

    it("allows suspending an ACTIVE stream", async () => {
      const prisma = makePrisma(makeStream());
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/suspend`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ reason: "Compliance hold" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("suspended");
    });

    it("allows resuming a SUSPENDED stream", async () => {
      const prisma = makePrisma(makeStream({ status: StreamStatus.SUSPENDED }));
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/resume`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ note: "Cleared" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("active");
    });

    it("allows terminating a live stream", async () => {
      const prisma = makePrisma(makeStream());
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/terminate`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ reason: "Offboarding" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(StreamStatus.TERMINATED);
    });
  });

  // ── Non-admin caller ───────────────────────────────────────────────────

  describe("admin protection", () => {
    it("rejects a non-admin caller before touching the stream (403)", async () => {
      const prisma = makePrisma(makeStream());
      const app = buildApp(prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/suspend`)
        .set("Authorization", `Bearer ${tokenFor(USER_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(403);
      expect(prisma.stream.findUnique).not.toHaveBeenCalled();
    });
  });
});

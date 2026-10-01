/**
 * Admin stream lock/unlock — POST /api/admin/streams/:id/lock and
 * POST /api/admin/streams/:id/unlock (#35).
 *
 * Covers admin protection, idempotent re-lock/re-unlock, lock-state
 * enforcement against other admin mutations, and the audit write.
 * Prisma is injected as a fake, and the env/rate-limit config modules
 * are mocked, so nothing here needs a database, an admin keypair or
 * Redis — a failure points at the route or the lock rules, not at
 * infrastructure.
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

import { createAdminStreamsRouter } from "../routes/admin.streams.routes";
import { StreamLockService } from "../services/streamLock.service";
import { StreamTerminationService } from "../services/streamTermination.service";
import { StreamValidationService } from "../services/streamValidation.service";
import { errorHandler } from "../middleware/errorHandler";
import { adminNotificationService } from "../services/adminNotification.service";

const notifyOperationFailedMock = adminNotificationService.notifyOperationFailed as jest.Mock;
const notifyStreamLockedMock = adminNotificationService.notifyStreamLocked as jest.Mock;
const notifyStreamUnlockedMock = adminNotificationService.notifyStreamUnlocked as jest.Mock;

const JWT_SECRET = "test-jwt-secret-value-with-minimum-length-32";
const ADMIN_ADDRESS = "GADMIN000000000000000000000000000000000000000000000000";
const USER_ADDRESS = "GUSER0000000000000000000000000000000000000000000000000";
const STREAM_ID = "stream-abc-123";

function tokenFor(walletAddress: string): string {
  return jwt.sign({ walletAddress, tokenId: "test-token-id" }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

type StreamRecord = {
  streamId: string;
  recipient: string;
  totalVested: string;
  claimed: string;
  unclaimed: string;
  pendingClawback: string;
  status: string;
  terminatedAt: Date | null;
  terminatedBy: string | null;
  terminationReason: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  lockReason: string | null;
};

function makeStream(overrides: Partial<StreamRecord> = {}): StreamRecord {
  return {
    streamId: STREAM_ID,
    recipient: "GRECIPIENT000000000000000000000000000000000000000000",
    totalVested: "10000",
    claimed: "2500",
    unclaimed: "7500",
    pendingClawback: "0",
    status: "ACTIVE",
    terminatedAt: null,
    terminatedBy: null,
    terminationReason: null,
    lockedAt: null,
    lockedBy: null,
    lockReason: null,
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
          current = { ...(current as StreamRecord), ...data } as StreamRecord;
          return { ...current };
        },
      ),
    },
    adminActionAudit: {
      create: jest.fn(async (args: unknown) => args),
    },
  };
}

function buildApp(lockService?: StreamLockService, prisma?: unknown): Express {
  const app = express();
  app.use(express.json());
  const termService = new StreamTerminationService(
    (prisma ?? makePrisma(makeStream())) as never,
  );
  app.use(
    "/api",
    createAdminStreamsRouter(
      termService,
      lockService,
      undefined,
      new StreamValidationService((prisma ?? makePrisma(makeStream())) as never),
    ),
  );
  app.use(errorHandler);
  return app;
}

describe("POST /api/admin/streams/:id/lock", () => {
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
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/lock`)
        .send({});

      expect(res.status).toBe(401);
      expect(prisma.stream.update).not.toHaveBeenCalled();
    });

    it("rejects a malformed bearer token (401)", async () => {
      const prisma = makePrisma(makeStream());
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/lock`)
        .set("Authorization", "Bearer not-a-jwt")
        .send({});

      expect(res.status).toBe(401);
      expect(prisma.stream.update).not.toHaveBeenCalled();
    });

    it("rejects an authenticated non-admin caller (403)", async () => {
      const prisma = makePrisma(makeStream());
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/lock`)
        .set("Authorization", `Bearer ${tokenFor(USER_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(403);
      expect(prisma.stream.findUnique).not.toHaveBeenCalled();
      expect(prisma.stream.update).not.toHaveBeenCalled();
    });
  });

  // ── Lock execution ──────────────────────────────────────────────────────

  describe("lock execution", () => {
    it("locks an unlocked stream and records who did it", async () => {
      const prisma = makePrisma(makeStream());
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/lock`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ reason: "Scheduled database migration" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        streamId: STREAM_ID,
        locked: true,
        lockedBy: ADMIN_ADDRESS,
        reason: "Scheduled database migration",
      });
      expect(typeof res.body.lockedAt).toBe("string");

      expect(prisma.stream.update).toHaveBeenCalledTimes(1);
      const updateArgs = prisma.stream.update.mock.calls[0][0] as {
        data: Partial<StreamRecord>;
      };
      expect(updateArgs.data.lockedBy).toBe(ADMIN_ADDRESS);
      expect(updateArgs.data.lockedAt).toBeInstanceOf(Date);
    });

    it("writes an admin audit record for the lock", async () => {
      const prisma = makePrisma(makeStream());
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/lock`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ reason: "Migration window" });

      expect(prisma.adminActionAudit.create).toHaveBeenCalledWith({
        data: {
          action: "STREAM_LOCK",
          actorAddress: ADMIN_ADDRESS,
          targetReference: STREAM_ID,
          note: "Migration window",
        },
      });
    });

    it("emits a notification on successful lock", async () => {
      const prisma = makePrisma(makeStream());
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/lock`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ reason: "Scheduled migration" });

      expect(notifyStreamLockedMock).toHaveBeenCalledTimes(1);
      expect(notifyStreamLockedMock).toHaveBeenCalledWith({
        streamId: STREAM_ID,
        adminAddress: ADMIN_ADDRESS,
        reason: "Scheduled migration",
        timestamp: expect.any(String),
      });
      expect(notifyOperationFailedMock).not.toHaveBeenCalled();
    });
  });

  // ── Idempotent re-lock ──────────────────────────────────────────────────

  describe("idempotent re-lock", () => {
    it("returns 200 when the stream is already locked (idempotent)", async () => {
      const prisma = makePrisma(
        makeStream({
          lockedAt: new Date("2026-07-30T10:00:00.000Z"),
          lockedBy: ADMIN_ADDRESS,
          lockReason: "Previous migration",
        }),
      );
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/lock`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ reason: "Another migration" });

      expect(res.status).toBe(200);
      expect(res.body.locked).toBe(true);
      // No additional update or audit for the no-op
      expect(prisma.stream.update).not.toHaveBeenCalled();
      expect(prisma.adminActionAudit.create).not.toHaveBeenCalled();
    });
  });

  // ── Unknown stream ──────────────────────────────────────────────────────

  describe("unknown stream", () => {
    it("returns 404 for a non-existent stream", async () => {
      const prisma = makePrisma(null);
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      const res = await request(app)
        .post("/api/admin/streams/does-not-exist/lock")
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(404);
      expect(prisma.stream.update).not.toHaveBeenCalled();
      expect(prisma.adminActionAudit.create).not.toHaveBeenCalled();
    });

    it("emits a failure notification when the stream is not found", async () => {
      const prisma = makePrisma(null);
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      await request(app)
        .post("/api/admin/streams/does-not-exist/lock")
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(notifyOperationFailedMock).toHaveBeenCalledTimes(1);
      const call = notifyOperationFailedMock.mock.calls[0][0];
      expect(call.streamId).toBe("does-not-exist");
      expect(call.action).toBe("STREAM_LOCK");
      expect(call.error.message).toContain("not found");
      expect(notifyStreamLockedMock).not.toHaveBeenCalled();
    });
  });

  // ── Payload validation ──────────────────────────────────────────────────

  describe("payload validation", () => {
    it("rejects a non-string reason (400)", async () => {
      const prisma = makePrisma(makeStream());
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/lock`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ reason: 42 });

      expect(res.status).toBe(400);
      expect(prisma.stream.update).not.toHaveBeenCalled();
    });

    it("rejects a reason longer than 500 characters (400)", async () => {
      const prisma = makePrisma(makeStream());
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/lock`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ reason: "x".repeat(501) });

      expect(res.status).toBe(400);
      expect(prisma.stream.update).not.toHaveBeenCalled();
    });
  });
});

describe("POST /api/admin/streams/:id/unlock", () => {
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
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/unlock`)
        .send({});

      expect(res.status).toBe(401);
      expect(prisma.stream.update).not.toHaveBeenCalled();
    });

    it("rejects an authenticated non-admin caller (403)", async () => {
      const prisma = makePrisma(makeStream());
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/unlock`)
        .set("Authorization", `Bearer ${tokenFor(USER_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(403);
    });
  });

  // ── Unlock execution ────────────────────────────────────────────────────

  describe("unlock execution", () => {
    it("unlocks a locked stream and clears lock fields", async () => {
      const prisma = makePrisma(
        makeStream({
          lockedAt: new Date("2026-07-30T10:00:00.000Z"),
          lockedBy: ADMIN_ADDRESS,
          lockReason: "Migration",
        }),
      );
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/unlock`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ reason: "Maintenance complete" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        streamId: STREAM_ID,
        locked: false,
        unlockedBy: ADMIN_ADDRESS,
        reason: "Maintenance complete",
      });
      expect(typeof res.body.unlockedAt).toBe("string");

      expect(prisma.stream.update).toHaveBeenCalledTimes(1);
      const updateArgs = prisma.stream.update.mock.calls[0][0] as {
        data: Partial<StreamRecord>;
      };
      expect(updateArgs.data.lockedAt).toBeNull();
      expect(updateArgs.data.lockedBy).toBeNull();
      expect(updateArgs.data.lockReason).toBeNull();
    });

    it("writes an admin audit record for the unlock", async () => {
      const prisma = makePrisma(
        makeStream({
          lockedAt: new Date("2026-07-30T10:00:00.000Z"),
          lockedBy: ADMIN_ADDRESS,
        }),
      );
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/unlock`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(prisma.adminActionAudit.create).toHaveBeenCalledWith({
        data: {
          action: "STREAM_UNLOCK",
          actorAddress: ADMIN_ADDRESS,
          targetReference: STREAM_ID,
          note: null,
        },
      });
    });

    it("emits a notification on successful unlock", async () => {
      const prisma = makePrisma(
        makeStream({
          lockedAt: new Date("2026-07-30T10:00:00.000Z"),
          lockedBy: ADMIN_ADDRESS,
        }),
      );
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/unlock`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({ reason: "Maintenance complete" });

      expect(notifyStreamUnlockedMock).toHaveBeenCalledTimes(1);
      expect(notifyStreamUnlockedMock).toHaveBeenCalledWith({
        streamId: STREAM_ID,
        adminAddress: ADMIN_ADDRESS,
        reason: "Maintenance complete",
        timestamp: expect.any(String),
      });
      expect(notifyOperationFailedMock).not.toHaveBeenCalled();
    });
  });

  // ── Idempotent re-unlock ────────────────────────────────────────────────

  describe("idempotent re-unlock", () => {
    it("returns 200 when the stream is already unlocked (idempotent)", async () => {
      const prisma = makePrisma(makeStream());
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/unlock`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.locked).toBe(false);
      expect(prisma.stream.update).not.toHaveBeenCalled();
      expect(prisma.adminActionAudit.create).not.toHaveBeenCalled();
    });
  });

  // ── Unknown stream ──────────────────────────────────────────────────────

  describe("unknown stream", () => {
    it("returns 404 for a non-existent stream", async () => {
      const prisma = makePrisma(null);
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      const res = await request(app)
        .post("/api/admin/streams/does-not-exist/unlock")
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(404);
      expect(prisma.stream.update).not.toHaveBeenCalled();
    });

    it("emits a failure notification when unlock stream is not found", async () => {
      const prisma = makePrisma(null);
      const lockService = new StreamLockService(prisma as never);
      const app = buildApp(lockService, prisma);

      await request(app)
        .post("/api/admin/streams/does-not-exist/unlock")
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(notifyOperationFailedMock).toHaveBeenCalledTimes(1);
      const call = notifyOperationFailedMock.mock.calls[0][0];
      expect(call.streamId).toBe("does-not-exist");
      expect(call.action).toBe("STREAM_UNLOCK");
      expect(call.error.message).toContain("not found");
    });
  });
});

describe("Lock enforcement — locked streams reject mutations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsMediatorAddress.mockImplementation(
      (address: string) => address === ADMIN_ADDRESS,
    );
  });

  function buildLockedApp(): {
    app: Express;
    prisma: ReturnType<typeof makePrisma>;
  } {
    const prisma = makePrisma(
      makeStream({
        lockedAt: new Date("2026-07-30T10:00:00.000Z"),
        lockedBy: ADMIN_ADDRESS,
        lockReason: "Maintenance",
      }),
    );
    const lockService = new StreamLockService(prisma as never);
    const termService = new StreamTerminationService(prisma as never);
    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      createAdminStreamsRouter(
        termService,
        lockService,
        undefined,
        new StreamValidationService(prisma as never),
      ),
    );
    app.use(errorHandler);
    return { app, prisma };
  }

  it("rejects suspend with 409 when stream is locked", async () => {
    const { app, prisma } = buildLockedApp();

    const res = await request(app)
      .post(`/api/admin/streams/${STREAM_ID}/suspend`)
      .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
      .send({});

    expect(res.status).toBe(409);
    expect(prisma.stream.update).not.toHaveBeenCalled();
  });

  it("rejects resume with 409 when stream is locked", async () => {
    const { app, prisma } = buildLockedApp();

    const res = await request(app)
      .post(`/api/admin/streams/${STREAM_ID}/resume`)
      .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
      .send({});

    expect(res.status).toBe(409);
    expect(prisma.stream.update).not.toHaveBeenCalled();
  });

  it("rejects terminate with 409 when stream is locked", async () => {
    const { app, prisma } = buildLockedApp();

    const res = await request(app)
      .post(`/api/admin/streams/${STREAM_ID}/terminate`)
      .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
      .send({});

    expect(res.status).toBe(409);
    expect(prisma.stream.update).not.toHaveBeenCalled();
  });

  it("returns lock details in the 409 body", async () => {
    const { app } = buildLockedApp();

    const res = await request(app)
      .post(`/api/admin/streams/${STREAM_ID}/suspend`)
      .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      message: expect.stringContaining("locked for maintenance"),
    });
  });
});

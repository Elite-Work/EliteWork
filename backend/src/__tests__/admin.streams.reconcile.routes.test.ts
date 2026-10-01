/**
 * Admin stream reconciliation — POST /api/admin/streams/:id/reconcile (#34).
 *
 * Covers admin protection, consistent state (no mismatches), inconsistent
 * state (mismatch detection), and unknown-stream handling. Prisma is injected
 * as a fake, so nothing here needs a database, an admin keypair or Redis.
 */

jest.mock("../config/env", () => {
  const actual = jest.requireActual("../config/env");
  return {
    ...actual,
    env: { ...actual.env, NODE_ENV: "test", JWT_SECRET: "test-jwt-secret-value-with-minimum-length-32" },
    runtimeEnvValue: (key: string) =>
      key === "JWT_SECRET" ? "test-jwt-secret-value-with-minimum-length-32" : actual.runtimeEnvValue(key),
  };
});

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
import {
  StreamTerminationService,
} from "../services/streamTermination.service";
import {
  StreamReconciliationService,
  ReconciliationMismatch,
} from "../services/streamReconciliation.service";
import { errorHandler } from "../middleware/errorHandler";

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

type ClawbackEvent = {
  streamId: string;
  admin: string;
  amount: string;
  timestamp: Date;
  txHash: string;
};

type AdminAuditRecord = {
  action: string;
  actorAddress: string;
  targetReference: string | null;
  note: string | null;
  createdAt: Date;
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

function makeReconciliationPrisma(overrides: {
  stream?: StreamRecord | null;
  clawbackEvents?: ClawbackEvent[];
  adminActions?: AdminAuditRecord[];
}) {
  const {
    stream = makeStream(),
    clawbackEvents = [],
    adminActions = [],
  } = overrides;

  return {
    stream: {
      findUnique: jest.fn(async ({ where }: { where: { streamId: string } }) =>
        stream && stream.streamId === where.streamId ? { ...stream } : null,
      ),
    },
    streamClawbackEvent: {
      findMany: jest.fn(async () => clawbackEvents),
    },
    adminActionAudit: {
      findMany: jest.fn(async () => adminActions),
    },
  };
}

function tokenFor(walletAddress: string): string {
  return jwt.sign({ walletAddress, tokenId: "test-token-id" }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

function buildApp(
  terminationService: StreamTerminationService,
  reconciliationService: StreamReconciliationService,
): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createAdminStreamsRouter(
      terminationService,
      undefined,
      undefined,
      undefined,
      reconciliationService,
    ),
  );
  app.use(errorHandler);
  return app;
}

/** Creates a StreamTerminationService that never gets called in reconcile tests. */
function dummyTerminationService() {
  return new StreamTerminationService(
    makeReconciliationPrisma({}) as never,
  );
}

describe("POST /api/admin/streams/:id/reconcile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsMediatorAddress.mockImplementation(
      (address: string) => address === ADMIN_ADDRESS,
    );
  });

  // ── Admin protection ────────────────────────────────────────────────────

  describe("admin protection", () => {
    it("rejects a request with no bearer token (401)", async () => {
      const prisma = makeReconciliationPrisma({});
      const app = buildApp(
        dummyTerminationService(),
        new StreamReconciliationService(prisma as never),
      );

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/reconcile`)
        .send({});

      expect(res.status).toBe(401);
    });

    it("rejects a malformed bearer token (401)", async () => {
      const prisma = makeReconciliationPrisma({});
      const app = buildApp(
        dummyTerminationService(),
        new StreamReconciliationService(prisma as never),
      );

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/reconcile`)
        .set("Authorization", "Bearer not-a-jwt")
        .send({});

      expect(res.status).toBe(401);
    });

    it("rejects an authenticated non-admin caller (403)", async () => {
      const prisma = makeReconciliationPrisma({});
      const app = buildApp(
        dummyTerminationService(),
        new StreamReconciliationService(prisma as never),
      );

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/reconcile`)
        .set("Authorization", `Bearer ${tokenFor(USER_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(403);
    });
  });

  // ── Consistent state ────────────────────────────────────────────────────

  describe("consistent state", () => {
    it("returns consistent=true with no mismatches when DB matches on-chain events", async () => {
      const stream = makeStream({
        totalVested: "10000",
        claimed: "2500",
        unclaimed: "7500",
        pendingClawback: "0",
        status: StreamStatus.ACTIVE,
      });

      const prisma = makeReconciliationPrisma({
        stream,
        clawbackEvents: [],
        adminActions: [],
      });

      const app = buildApp(
        dummyTerminationService(),
        new StreamReconciliationService(prisma as never),
      );

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/reconcile`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.consistent).toBe(true);
      expect(res.body.mismatches).toEqual([]);
      expect(res.body.streamSnapshot).toMatchObject({
        status: "ACTIVE",
        totalVested: "10000",
        claimed: "2500",
        unclaimed: "7500",
        pendingClawback: "0",
      });
      expect(res.body.onChainSummary.clawbackEventCount).toBe(0);
      expect(res.body.onChainSummary.totalClawedBackOnChain).toBe("0");
      expect(res.body.adminActionCount).toBe(0);
      expect(typeof res.body.reconciledAt).toBe("string");
    });

    it("is consistent when pendingClawback matches on-chain clawback sum", async () => {
      const stream = makeStream({
        totalVested: "10000",
        claimed: "2000",
        unclaimed: "5000",
        pendingClawback: "3000",
        status: StreamStatus.ACTIVE,
      });

      const prisma = makeReconciliationPrisma({
        stream,
        clawbackEvents: [
          {
            streamId: STREAM_ID,
            admin: ADMIN_ADDRESS,
            amount: "1000",
            timestamp: new Date("2026-01-01T00:00:00.000Z"),
            txHash: "tx-001",
          },
          {
            streamId: STREAM_ID,
            admin: ADMIN_ADDRESS,
            amount: "2000",
            timestamp: new Date("2026-01-02T00:00:00.000Z"),
            txHash: "tx-002",
          },
        ],
        adminActions: [],
      });

      const app = buildApp(
        dummyTerminationService(),
        new StreamReconciliationService(prisma as never),
      );

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/reconcile`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.consistent).toBe(true);
      expect(res.body.mismatches).toEqual([]);
      expect(res.body.onChainSummary.clawbackEventCount).toBe(2);
      expect(res.body.onChainSummary.totalClawedBackOnChain).toBe("3000");
    });

    it("is consistent when stream is TERMINATED and audit shows terminate action", async () => {
      const stream = makeStream({
        status: StreamStatus.TERMINATED,
        terminatedAt: new Date("2026-01-15T00:00:00.000Z"),
        terminatedBy: ADMIN_ADDRESS,
        terminationReason: "Offboarded",
      });

      const prisma = makeReconciliationPrisma({
        stream,
        clawbackEvents: [],
        adminActions: [
          {
            action: "STREAM_TERMINATE",
            actorAddress: ADMIN_ADDRESS,
            targetReference: STREAM_ID,
            note: "Offboarded",
            createdAt: new Date("2026-01-15T00:00:00.000Z"),
          },
        ],
      });

      const app = buildApp(
        dummyTerminationService(),
        new StreamReconciliationService(prisma as never),
      );

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/reconcile`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.consistent).toBe(true);
      expect(res.body.adminActionCount).toBe(1);
    });
  });

  // ── Inconsistent state ──────────────────────────────────────────────────

  describe("inconsistent state", () => {
    it("detects pendingClawback mismatch between DB and on-chain sum", async () => {
      const stream = makeStream({
        totalVested: "10000",
        claimed: "2000",
        unclaimed: "8000",
        pendingClawback: "0", // DB says 0, but on-chain has clawbacks
        status: StreamStatus.ACTIVE,
      });

      const prisma = makeReconciliationPrisma({
        stream,
        clawbackEvents: [
          {
            streamId: STREAM_ID,
            admin: ADMIN_ADDRESS,
            amount: "5000",
            timestamp: new Date("2026-02-01T00:00:00.000Z"),
            txHash: "tx-claw-001",
          },
        ],
        adminActions: [],
      });

      const app = buildApp(
        dummyTerminationService(),
        new StreamReconciliationService(prisma as never),
      );

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/reconcile`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.consistent).toBe(false);
      expect(res.body.mismatches.length).toBeGreaterThanOrEqual(1);

      const pendingMismatch = res.body.mismatches.find(
        (m: ReconciliationMismatch) => m.field === "pendingClawback",
      );
      expect(pendingMismatch).toBeDefined();
      expect(pendingMismatch.expected).toBe("5000");
      expect(pendingMismatch.actual).toBe("0");
      expect(pendingMismatch.source).toBe("on-chain");
    });

    it("detects unclaimed mismatch when on-chain clawbacks change the computation", async () => {
      const stream = makeStream({
        totalVested: "10000",
        claimed: "1000",
        unclaimed: "9000", // should be 4000 (10000 - 1000 - 5000)
        pendingClawback: "0", // should be 5000
        status: StreamStatus.ACTIVE,
      });

      const prisma = makeReconciliationPrisma({
        stream,
        clawbackEvents: [
          {
            streamId: STREAM_ID,
            admin: ADMIN_ADDRESS,
            amount: "5000",
            timestamp: new Date("2026-03-01T00:00:00.000Z"),
            txHash: "tx-claw-002",
          },
        ],
        adminActions: [],
      });

      const app = buildApp(
        dummyTerminationService(),
        new StreamReconciliationService(prisma as never),
      );

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/reconcile`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.consistent).toBe(false);

      const unclaimedMismatch = res.body.mismatches.find(
        (m: ReconciliationMismatch) => m.field === "unclaimed",
      );
      expect(unclaimedMismatch).toBeDefined();
      expect(unclaimedMismatch.expected).toBe("4000");
      expect(unclaimedMismatch.actual).toBe("9000");
      expect(unclaimedMismatch.source).toBe("computed");
    });

    it("detects status mismatch when audit shows termination but stream is still ACTIVE", async () => {
      const stream = makeStream({
        status: StreamStatus.ACTIVE,
      });

      const prisma = makeReconciliationPrisma({
        stream,
        clawbackEvents: [],
        adminActions: [
          {
            action: "STREAM_TERMINATE",
            actorAddress: ADMIN_ADDRESS,
            targetReference: STREAM_ID,
            note: "Admin terminated this stream",
            createdAt: new Date("2026-04-01T00:00:00.000Z"),
          },
        ],
      });

      const app = buildApp(
        dummyTerminationService(),
        new StreamReconciliationService(prisma as never),
      );

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/reconcile`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.consistent).toBe(false);

      const statusMismatch = res.body.mismatches.find(
        (m: ReconciliationMismatch) => m.field === "status",
      );
      expect(statusMismatch).toBeDefined();
      expect(statusMismatch.expected).toBe("TERMINATED");
      expect(statusMismatch.actual).toBe("ACTIVE");
      expect(statusMismatch.source).toBe("backend");
    });

    it("detects when stream is TERMINATED but no terminate audit record exists", async () => {
      const stream = makeStream({
        status: StreamStatus.TERMINATED,
        terminatedAt: new Date("2026-06-01T00:00:00.000Z"),
        terminatedBy: ADMIN_ADDRESS,
      });

      // No admin actions — so there's no STREAM_TERMINATE audit record
      const prisma = makeReconciliationPrisma({
        stream,
        clawbackEvents: [],
        adminActions: [],
      });

      const app = buildApp(
        dummyTerminationService(),
        new StreamReconciliationService(prisma as never),
      );

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/reconcile`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.consistent).toBe(false);

      const statusMismatch = res.body.mismatches.find(
        (m: ReconciliationMismatch) => m.field === "status",
      );
      expect(statusMismatch).toBeDefined();
      expect(statusMismatch.expected).toContain("no terminate audit record");
      expect(statusMismatch.actual).toBe("TERMINATED");
      expect(statusMismatch.source).toBe("backend");
    });
  });

  // ── Unknown stream ──────────────────────────────────────────────────────

  describe("unknown stream", () => {
    it("returns 404 for an unknown stream", async () => {
      const prisma = makeReconciliationPrisma({ stream: null });
      const app = buildApp(
        dummyTerminationService(),
        new StreamReconciliationService(prisma as never),
      );

      const res = await request(app)
        .post("/api/admin/streams/does-not-exist/reconcile")
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(404);
    });
  });

  // ── Payload validation ──────────────────────────────────────────────────

  describe("payload validation", () => {
    it("accepts POST with no body (no request body schema)", async () => {
      const prisma = makeReconciliationPrisma({});
      const app = buildApp(
        dummyTerminationService(),
        new StreamReconciliationService(prisma as never),
      );

      const res = await request(app)
        .post(`/api/admin/streams/${STREAM_ID}/reconcile`)
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      expect(res.status).toBe(200);
    });

    it("rejects a request with missing stream ID param (400)", async () => {
      const prisma = makeReconciliationPrisma({});
      const app = buildApp(
        dummyTerminationService(),
        new StreamReconciliationService(prisma as never),
      );

      const res = await request(app)
        .post("/api/admin/streams//reconcile")
        .set("Authorization", `Bearer ${tokenFor(ADMIN_ADDRESS)}`)
        .send({});

      // Express may 404 on empty param OR hit validation — both are acceptable
      expect([400, 404]).toContain(res.status);
    });
  });
});

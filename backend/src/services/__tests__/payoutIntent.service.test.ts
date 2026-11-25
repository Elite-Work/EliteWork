/**
 * Unit tests for PayoutIntentService: creation, state transitions, and the
 * idempotency guard. Prisma is a plain jest mock so each test controls exactly
 * what the database returns; the constraint-level crash-window scenarios live
 * in src/__tests__/payout.idempotency.test.ts.
 */

import { Prisma, PayoutIntent, PayoutIntentStatus, PrismaClient } from "@prisma/client";

jest.mock("../../lib/metrics", () => ({
  recordPayoutIntentOutcome: jest.fn(),
}));

jest.mock("../../middleware/logger", () => ({
  appLogger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { recordPayoutIntentOutcome } from "../../lib/metrics";
import { appLogger } from "../../middleware/logger";
import {
  DuplicatePayoutError,
  PayoutIntentInput,
  PayoutIntentService,
  derivePayoutIdempotencyKey,
} from "../payoutIntent.service";

const metrics = recordPayoutIntentOutcome as jest.Mock;

const baseInput: PayoutIntentInput = {
  kind: "RELEASE",
  tradeId: "trade-1",
  amountUsdc: "100.00",
  destination: "GDESTINATIONADDRESS",
  requestedBy: "GREQUESTER",
};

function makeIntent(overrides: Partial<PayoutIntent> = {}): PayoutIntent {
  return {
    id: 1,
    idempotencyKey: "key-1",
    kind: "RELEASE",
    tradeId: "trade-1",
    milestoneIndex: null,
    amountUsdc: "100.00",
    destination: "GDESTINATIONADDRESS",
    requestedBy: "GREQUESTER",
    status: "PENDING",
    txHash: null,
    lastError: null,
    duplicateAttempts: 0,
    submittedAt: null,
    confirmedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as PayoutIntent;
}

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "5.22.0",
  });
}

function makePrisma() {
  return {
    payoutIntent: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

type MockPrisma = ReturnType<typeof makePrisma>;

describe("PayoutIntentService", () => {
  let prisma: MockPrisma;
  let service: PayoutIntentService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrisma();
    service = new PayoutIntentService(prisma as unknown as PrismaClient);
  });

  describe("derivePayoutIdempotencyKey", () => {
    it("is deterministic and prefixed with derived:", () => {
      const a = derivePayoutIdempotencyKey(baseInput);
      const b = derivePayoutIdempotencyKey({ ...baseInput });
      expect(a).toBe(b);
      expect(a).toMatch(/^derived:[0-9a-f]{64}$/);
    });

    it("ignores destination casing", () => {
      expect(
        derivePayoutIdempotencyKey({ ...baseInput, destination: "gdestinationaddress" }),
      ).toBe(derivePayoutIdempotencyKey(baseInput));
    });

    it("treats a missing milestoneIndex and null as the same payout", () => {
      expect(derivePayoutIdempotencyKey({ ...baseInput, milestoneIndex: null })).toBe(
        derivePayoutIdempotencyKey(baseInput),
      );
    });

    it.each([
      ["amount", { amountUsdc: "100.01" }],
      ["kind", { kind: "REFUND" as const }],
      ["trade", { tradeId: "trade-2" }],
      ["milestone", { milestoneIndex: 0 }],
      ["destination", { destination: "GOTHER" }],
    ])("changes when the %s changes", (_label, change) => {
      expect(derivePayoutIdempotencyKey({ ...baseInput, ...change })).not.toBe(
        derivePayoutIdempotencyKey(baseInput),
      );
    });

    it("ignores requestedBy and a caller-supplied key", () => {
      expect(
        derivePayoutIdempotencyKey({ ...baseInput, requestedBy: "GSOMEONEELSE", idempotencyKey: "x" }),
      ).toBe(derivePayoutIdempotencyKey(baseInput));
    });
  });

  describe("claim — creation", () => {
    it("creates a PENDING intent with the caller-supplied key", async () => {
      const created = makeIntent({ idempotencyKey: "client-key" });
      prisma.payoutIntent.create.mockResolvedValue(created);

      const result = await service.claim({ ...baseInput, idempotencyKey: "client-key", milestoneIndex: 2 });

      expect(result).toEqual({ intent: created, duplicate: false });
      expect(prisma.payoutIntent.create).toHaveBeenCalledWith({
        data: {
          idempotencyKey: "client-key",
          kind: "RELEASE",
          tradeId: "trade-1",
          milestoneIndex: 2,
          amountUsdc: "100.00",
          destination: "GDESTINATIONADDRESS",
          requestedBy: "GREQUESTER",
          status: "PENDING",
        },
      });
      expect(metrics).toHaveBeenCalledWith("RELEASE", "claimed");
      expect(prisma.payoutIntent.update).not.toHaveBeenCalled();
    });

    it("derives the key and stores milestoneIndex as null when omitted", async () => {
      prisma.payoutIntent.create.mockResolvedValue(makeIntent());

      await service.claim(baseInput);

      const { data } = prisma.payoutIntent.create.mock.calls[0][0];
      expect(data.idempotencyKey).toBe(derivePayoutIdempotencyKey(baseInput));
      expect(data.milestoneIndex).toBeNull();
    });

    it("rethrows database errors that are not unique violations", async () => {
      const boom = new Error("connection lost");
      prisma.payoutIntent.create.mockRejectedValue(boom);

      await expect(service.claim(baseInput)).rejects.toBe(boom);
      expect(prisma.payoutIntent.update).not.toHaveBeenCalled();
      expect(metrics).not.toHaveBeenCalled();
    });

    it("rethrows Prisma known errors with a non-P2002 code", async () => {
      const fkError = new Prisma.PrismaClientKnownRequestError("FK failed", {
        code: "P2003",
        clientVersion: "5.22.0",
      });
      prisma.payoutIntent.create.mockRejectedValue(fkError);

      await expect(service.claim(baseInput)).rejects.toBe(fkError);
      expect(prisma.payoutIntent.update).not.toHaveBeenCalled();
    });
  });

  describe("claim — idempotency guard", () => {
    it.each<PayoutIntentStatus>(["PENDING", "SUBMITTED", "FAILED"])(
      "returns the existing %s intent as a duplicate and counts the attempt",
      async (status) => {
        const existing = makeIntent({ idempotencyKey: "client-key", status, duplicateAttempts: 1 });
        prisma.payoutIntent.create.mockRejectedValue(uniqueViolation());
        prisma.payoutIntent.update.mockResolvedValue(existing);

        const result = await service.claim({ ...baseInput, idempotencyKey: "client-key" });

        expect(result).toEqual({ intent: existing, duplicate: true });
        expect(prisma.payoutIntent.update).toHaveBeenCalledWith({
          where: { idempotencyKey: "client-key" },
          data: { duplicateAttempts: { increment: 1 } },
        });
        expect(metrics).toHaveBeenCalledWith("RELEASE", "duplicate");
        expect(metrics).not.toHaveBeenCalledWith("RELEASE", "claimed");
        expect(appLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ idempotencyKey: "client-key", status, duplicateAttempts: 1 }),
          "Duplicate payout attempt short-circuited",
        );
      },
    );

    it("throws DuplicatePayoutError when the payout is already CONFIRMED", async () => {
      const existing = makeIntent({ status: "CONFIRMED", txHash: "abc123" });
      prisma.payoutIntent.create.mockRejectedValue(uniqueViolation());
      prisma.payoutIntent.update.mockResolvedValue(existing);

      const error = await service.claim({ ...baseInput, idempotencyKey: "key-1" }).catch((e) => e);

      expect(error).toBeInstanceOf(DuplicatePayoutError);
      expect(error.name).toBe("DuplicatePayoutError");
      expect(error.intent).toBe(existing);
      expect(error.message).toBe("Payout key-1 already completed on-chain as abc123");
      expect(metrics).toHaveBeenCalledWith("RELEASE", "duplicate");
    });

    it("omits the tx hash from the error message when none was recorded", () => {
      const error = new DuplicatePayoutError(makeIntent({ status: "CONFIRMED" }));
      expect(error.message).toBe("Payout key-1 already completed on-chain");
    });

    it("looks up the duplicate by the derived key when none was supplied", async () => {
      prisma.payoutIntent.create.mockRejectedValue(uniqueViolation());
      prisma.payoutIntent.update.mockResolvedValue(makeIntent());

      await service.claim(baseInput);

      expect(prisma.payoutIntent.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { idempotencyKey: derivePayoutIdempotencyKey(baseInput) } }),
      );
    });
  });

  describe("state transitions", () => {
    it("recordSubmission moves the intent to SUBMITTED with the tx hash", async () => {
      const updated = makeIntent({ status: "SUBMITTED", txHash: "tx1" });
      prisma.payoutIntent.update.mockResolvedValue(updated);

      await expect(service.recordSubmission("key-1", "tx1")).resolves.toBe(updated);

      const call = prisma.payoutIntent.update.mock.calls[0][0];
      expect(call.where).toEqual({ idempotencyKey: "key-1" });
      expect(call.data).toEqual({ status: "SUBMITTED", txHash: "tx1", submittedAt: expect.any(Date) });
      expect(metrics).toHaveBeenCalledWith("RELEASE", "submitted");
    });

    it("confirm moves the intent to CONFIRMED and keeps the recorded hash when none is passed", async () => {
      prisma.payoutIntent.update.mockResolvedValue(makeIntent({ status: "CONFIRMED" }));

      await service.confirm("key-1");

      const { data } = prisma.payoutIntent.update.mock.calls[0][0];
      expect(data).toEqual({ status: "CONFIRMED", confirmedAt: expect.any(Date) });
      expect(data).not.toHaveProperty("txHash");
      expect(metrics).toHaveBeenCalledWith("RELEASE", "confirmed");
    });

    it("confirm writes the tx hash when one is passed", async () => {
      prisma.payoutIntent.update.mockResolvedValue(makeIntent({ status: "CONFIRMED", txHash: "tx2" }));

      await service.confirm("key-1", "tx2");

      expect(prisma.payoutIntent.update.mock.calls[0][0].data).toEqual({
        status: "CONFIRMED",
        confirmedAt: expect.any(Date),
        txHash: "tx2",
      });
    });

    it("fail moves the intent to FAILED and truncates the reason to 2000 chars", async () => {
      prisma.payoutIntent.update.mockResolvedValue(makeIntent({ status: "FAILED", kind: "REFUND" }));

      await service.fail("key-1", "x".repeat(5000));

      const { data } = prisma.payoutIntent.update.mock.calls[0][0];
      expect(data.status).toBe("FAILED");
      expect(data.lastError).toHaveLength(2000);
      expect(metrics).toHaveBeenCalledWith("REFUND", "failed");
    });

    it("propagates errors when the intent does not exist", async () => {
      const notFound = new Prisma.PrismaClientKnownRequestError("Record not found", {
        code: "P2025",
        clientVersion: "5.22.0",
      });
      prisma.payoutIntent.update.mockRejectedValue(notFound);

      await expect(service.recordSubmission("missing", "tx")).rejects.toBe(notFound);
      expect(metrics).not.toHaveBeenCalled();
    });

    it("a confirmed intent blocks every later claim on the same key", async () => {
      prisma.payoutIntent.create.mockResolvedValueOnce(makeIntent());
      prisma.payoutIntent.update
        .mockResolvedValueOnce(makeIntent({ status: "SUBMITTED", txHash: "tx" }))
        .mockResolvedValueOnce(makeIntent({ status: "CONFIRMED", txHash: "tx" }))
        .mockResolvedValueOnce(makeIntent({ status: "CONFIRMED", txHash: "tx", duplicateAttempts: 1 }));
      prisma.payoutIntent.create.mockRejectedValueOnce(uniqueViolation());

      const input = { ...baseInput, idempotencyKey: "key-1" };
      await expect(service.claim(input)).resolves.toMatchObject({ duplicate: false });
      await service.recordSubmission("key-1", "tx");
      await service.confirm("key-1");
      await expect(service.claim(input)).rejects.toBeInstanceOf(DuplicatePayoutError);

      expect(metrics.mock.calls.map((c) => c[1])).toEqual([
        "claimed",
        "submitted",
        "confirmed",
        "duplicate",
      ]);
    });
  });

  describe("findByKey / findUnresolved", () => {
    it("findByKey queries by idempotency key", async () => {
      prisma.payoutIntent.findUnique.mockResolvedValue(null);
      await expect(service.findByKey("key-1")).resolves.toBeNull();
      expect(prisma.payoutIntent.findUnique).toHaveBeenCalledWith({ where: { idempotencyKey: "key-1" } });
    });

    it("findUnresolved filters PENDING/SUBMITTED older than the cutoff, oldest first", async () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-06-01T00:10:00Z"));
      prisma.payoutIntent.findMany.mockResolvedValue([]);

      try {
        await service.findUnresolved(5 * 60_000, 10);
      } finally {
        jest.useRealTimers();
      }

      expect(prisma.payoutIntent.findMany).toHaveBeenCalledWith({
        where: {
          status: { in: ["PENDING", "SUBMITTED"] },
          updatedAt: { lt: new Date("2026-06-01T00:05:00Z") },
        },
        orderBy: { updatedAt: "asc" },
        take: 10,
      });
    });

    it("findUnresolved defaults to a 60s cutoff and a batch of 100", async () => {
      prisma.payoutIntent.findMany.mockResolvedValue([]);
      await service.findUnresolved();
      expect(prisma.payoutIntent.findMany.mock.calls[0][0].take).toBe(100);
    });
  });

  describe("reconcile", () => {
    it("resolves each unresolved intent according to the chain outcome", async () => {
      prisma.payoutIntent.findMany.mockResolvedValue([
        makeIntent({ idempotencyKey: "no-hash", status: "PENDING" }),
        makeIntent({ idempotencyKey: "ok", status: "SUBMITTED", txHash: "tx-ok" }),
        makeIntent({ idempotencyKey: "bad", status: "SUBMITTED", txHash: "tx-bad" }),
        makeIntent({ idempotencyKey: "unknown", status: "SUBMITTED", txHash: "tx-unknown" }),
      ]);
      prisma.payoutIntent.update.mockImplementation(async ({ where, data }) =>
        makeIntent({ idempotencyKey: where.idempotencyKey, ...data }),
      );
      const lookup = jest.fn(async (hash: string) =>
        hash === "tx-ok" ? "SUCCESS" : hash === "tx-bad" ? "FAILED" : "NOT_FOUND",
      ) as jest.Mock<Promise<"SUCCESS" | "FAILED" | "NOT_FOUND">, [string]>;

      const summary = await service.reconcile(lookup, { olderThanMs: 1000, limit: 50 });

      expect(summary).toEqual({ scanned: 4, confirmed: 1, failed: 2, pending: 1 });
      expect(lookup).toHaveBeenCalledTimes(3);
      expect(lookup).not.toHaveBeenCalledWith(null);

      const updates = Object.fromEntries(
        prisma.payoutIntent.update.mock.calls.map(([arg]) => [arg.where.idempotencyKey, arg.data]),
      );
      expect(updates["no-hash"]).toEqual({
        status: "FAILED",
        lastError: "Reconciled: no transaction was submitted",
      });
      expect(updates.ok).toMatchObject({ status: "CONFIRMED" });
      expect(updates.bad).toEqual({ status: "FAILED", lastError: "Reconciled: transaction failed on-chain" });
      expect(updates).not.toHaveProperty("unknown");
      expect(prisma.payoutIntent.findMany.mock.calls[0][0].take).toBe(50);
    });

    it("returns zeros when nothing is unresolved", async () => {
      prisma.payoutIntent.findMany.mockResolvedValue([]);
      const lookup = jest.fn();

      await expect(service.reconcile(lookup)).resolves.toEqual({
        scanned: 0,
        confirmed: 0,
        failed: 0,
        pending: 0,
      });
      expect(lookup).not.toHaveBeenCalled();
    });
  });
});

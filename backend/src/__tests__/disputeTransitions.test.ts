import { Dispute, DisputeStatus, Prisma } from "@prisma/client";
import {
  applyDisputeStatusTransition,
  syncDisputeInitiatedFromChain,
  syncDisputeResolvedFromChain,
} from "../services/disputeTransitions";

type MockTx = {
  dispute: {
    findUnique: jest.MockedFunction<
      (args: Prisma.DisputeFindUniqueArgs) => Promise<Dispute | null>
    >;
    create: jest.MockedFunction<
      (args: Prisma.DisputeCreateArgs) => Promise<Dispute>
    >;
    updateMany: jest.MockedFunction<
      (args: Prisma.DisputeUpdateManyArgs) => Promise<Prisma.BatchPayload>
    >;
  };
};

function createMockTx(): MockTx {
  return {
    dispute: {
      findUnique: jest.fn<
        Promise<Dispute | null>,
        [args: Prisma.DisputeFindUniqueArgs]
      >(),
      create: jest.fn<
        Promise<Dispute>,
        [args: Prisma.DisputeCreateArgs]
      >(),
      updateMany: jest.fn<
        Promise<Prisma.BatchPayload>,
        [args: Prisma.DisputeUpdateManyArgs]
      >(),
    },
  };
}

function asTransactionClient(mock: MockTx): Prisma.TransactionClient {
  return mock as unknown as Prisma.TransactionClient;
}

const FIXED_DATE = new Date("2026-05-27T00:00:00.000Z");

function makeDispute(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: 1,
    tradeId: "T-001",
    initiator: "GA_BUYER",
    reason: "Test dispute",
    status: DisputeStatus.OPEN,
    version: 0,
    resolvedAt: null,
    categoryId: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

describe("disputeTransitions", () => {
  let mockTx: ReturnType<typeof createMockTx>;

  beforeEach(() => {
    mockTx = createMockTx();
  });

  describe("applyDisputeStatusTransition", () => {
    it("returns true when CAS update succeeds", async () => {
      mockTx.dispute.updateMany.mockResolvedValue({ count: 1 });

      const applied = await applyDisputeStatusTransition(
        asTransactionClient(mockTx),
        { id: 1, status: DisputeStatus.OPEN, version: 2 },
        DisputeStatus.UNDER_REVIEW,
      );

      expect(applied).toBe(true);
      expect(mockTx.dispute.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: DisputeStatus.OPEN, version: 2 },
        data: {
          status: DisputeStatus.UNDER_REVIEW,
          version: { increment: 1 },
        },
      });
    });

    it("returns false when another writer wins the race", async () => {
      mockTx.dispute.updateMany.mockResolvedValue({ count: 0 });

      const applied = await applyDisputeStatusTransition(
        asTransactionClient(mockTx),
        { id: 1, status: DisputeStatus.OPEN, version: 2 },
        DisputeStatus.UNDER_REVIEW,
      );

      expect(applied).toBe(false);
    });
  });

  describe("syncDisputeInitiatedFromChain", () => {
    it("creates an OPEN dispute when none exists", async () => {
      mockTx.dispute.findUnique.mockResolvedValue(null);

      await syncDisputeInitiatedFromChain(asTransactionClient(mockTx), "T-001", "GA_BUYER");

      expect(mockTx.dispute.create).toHaveBeenCalledWith({
        data: {
          tradeId: "T-001",
          initiator: "GA_BUYER",
          reason: "On-chain dispute initiation",
          status: DisputeStatus.OPEN,
          version: 0,
        },
      });
    });

    it("is idempotent when a dispute row already exists", async () => {
      mockTx.dispute.findUnique.mockResolvedValue(
        makeDispute({ status: DisputeStatus.OPEN }),
      );

      await syncDisputeInitiatedFromChain(asTransactionClient(mockTx), "T-001", "GA_BUYER");

      expect(mockTx.dispute.create).not.toHaveBeenCalled();
    });
  });

  describe("syncDisputeResolvedFromChain", () => {
    it("marks active disputes RESOLVED with a version guard", async () => {
      mockTx.dispute.findUnique.mockResolvedValue(
        makeDispute({
          id: 9,
          status: DisputeStatus.OPEN,
          version: 4,
        }),
      );
      mockTx.dispute.updateMany.mockResolvedValue({ count: 1 });

      await syncDisputeResolvedFromChain(asTransactionClient(mockTx), "T-001");

      expect(mockTx.dispute.updateMany).toHaveBeenCalledWith({
        where: {
          id: 9,
          status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
          version: 4,
        },
        data: {
          status: DisputeStatus.RESOLVED,
          resolvedAt: expect.any(Date),
          version: { increment: 1 },
        },
      });
    });

    it("no-ops when the dispute is already terminal", async () => {
      mockTx.dispute.findUnique.mockResolvedValue(
        makeDispute({
          id: 9,
          status: DisputeStatus.RESOLVED,
          version: 5,
        }),
      );

      await syncDisputeResolvedFromChain(asTransactionClient(mockTx), "T-001");

      expect(mockTx.dispute.updateMany).not.toHaveBeenCalled();
    });

    it("throws when the CAS update loses a concurrent race", async () => {
      mockTx.dispute.findUnique.mockResolvedValue(
        makeDispute({
          id: 9,
          status: DisputeStatus.UNDER_REVIEW,
          version: 1,
        }),
      );
      mockTx.dispute.updateMany.mockResolvedValue({ count: 0 });

      await expect(syncDisputeResolvedFromChain(asTransactionClient(mockTx), "T-001")).rejects.toThrow(
        "Dispute concurrency conflict during chain sync",
      );
    });
  });
});

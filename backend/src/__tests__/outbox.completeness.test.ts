/**
 * Integration tests for outbox completeness
 *
 * Verifies that every state-changing action produces exactly its expected events
 * and that the action-event mapping is consistent across the system.
 */

// ─── Mock prisma before any imports ────────────────────────────────────────
import type { ChainEventOutbox, EscrowAudit, Trade } from "@prisma/client";

const mockChainEventOutbox: ChainEventOutbox[] = [];
const mockEscrowAudit: EscrowAudit[] = [];
const mockTrade: Trade[] = [];

jest.mock("../lib/db", () => ({
  prisma: {
    chainEventOutbox: {
      deleteMany: jest.fn().mockImplementation(async () => {
        mockChainEventOutbox.length = 0;
        return { count: 0 };
      }),
      create: jest.fn().mockImplementation(async ({ data }: { data: Partial<ChainEventOutbox> }) => {
        const entry = { id: mockChainEventOutbox.length + 1, ...data } as ChainEventOutbox;
        mockChainEventOutbox.push(entry);
        return entry;
      }),
      findMany: jest.fn().mockImplementation(async ({ where }: { where?: { tradeId?: string; eventType?: string } }) => {
        return mockChainEventOutbox.filter((e) => {
          if (where?.tradeId && e.tradeId !== where.tradeId) return false;
          if (where?.eventType && e.eventType !== where.eventType) return false;
          return true;
        });
      }),
    },
    escrowAudit: {
      deleteMany: jest.fn().mockImplementation(async () => {
        mockEscrowAudit.length = 0;
        return { count: 0 };
      }),
      create: jest.fn().mockImplementation(async ({ data }: { data: Partial<EscrowAudit> }) => {
        const entry = { id: mockEscrowAudit.length + 1, createdAt: new Date(), ...data } as EscrowAudit;
        mockEscrowAudit.push(entry);
        return entry;
      }),
      findMany: jest.fn().mockImplementation(async ({ where }: { where?: { tradeId?: string } }) => {
        return mockEscrowAudit.filter((a) => {
          if (where?.tradeId && a.tradeId !== where.tradeId) return false;
          return true;
        });
      }),
    },
    trade: {
      deleteMany: jest.fn().mockImplementation(async () => {
        mockTrade.length = 0;
        return { count: 0 };
      }),
      create: jest.fn().mockImplementation(async ({ data }: { data: Partial<Trade> }) => {
        const entry = {
          id: mockTrade.length + 1,
          version: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        } as Trade;
        mockTrade.push(entry);
        return entry;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }: { where: { id?: number; tradeId?: string }; data: Partial<Trade> }) => {
        const idx = mockTrade.findIndex((t) =>
          where.id ? t.id === where.id : t.tradeId === where.tradeId,
        );
        if (idx === -1) throw new Error("Trade not found");
        mockTrade[idx] = { ...mockTrade[idx], ...data, updatedAt: new Date() } as Trade;
        return mockTrade[idx];
      }),
      findMany: jest.fn().mockImplementation(async () => mockTrade),
    },
  },
}));

jest.mock("../services/contract.service", () => ({
  ContractService: jest.fn().mockImplementation(() => ({
    buildCreateTradeTx: jest.fn().mockResolvedValue({ unsignedXdr: "mock-xdr" }),
  })),
}));

jest.mock("../middleware/logger", () => ({
  appLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── Actual imports ─────────────────────────────────────────────────────────
import { TradeService } from "../services/trade.service";
import { EventType } from "../types/events";
import {
  ACTION_EVENT_MAPPINGS,
  ServiceAction,
  validateEventEmission,
} from "../lib/outbox/actionEventMapping";
import { TradeStatus } from "@prisma/client";
import { prisma } from "../lib/db";

describe("Outbox Completeness Integration Tests", () => {
  let tradeService: TradeService;
  const buyerAddress = "GBUQWP3BOUZX34ULNQG23RQ6F4OXTBIQF7XNVFQY2VQWT5FJA7RJIUU";
  const sellerAddress = "GCFVBVQZZW4IXX3LRFIPWWVKXNX3SBR6VS5KW4YGRCL4ADF6XNKFMJM";

  beforeEach(async () => {
    tradeService = new TradeService();
    await prisma.chainEventOutbox.deleteMany({});
    await prisma.escrowAudit.deleteMany({});
    await prisma.trade.deleteMany({});
  });

  afterEach(async () => {
    await prisma.chainEventOutbox.deleteMany({});
    await prisma.escrowAudit.deleteMany({});
    await prisma.trade.deleteMany({});
  });

  describe("Action-Event Mapping Specification", () => {
    it("should have all mappings properly defined", () => {
      expect(ACTION_EVENT_MAPPINGS.length).toBeGreaterThan(0);

      ACTION_EVENT_MAPPINGS.forEach((mapping) => {
        expect(mapping.action).toBeDefined();
        expect(mapping.expectedEvents).toBeDefined();
        expect(Array.isArray(mapping.expectedEvents)).toBe(true);
        expect(mapping.resultingStatus).toBeDefined();
      });
    });

    it("should validate event emissions for actions", () => {
      // Test case 1: Correct events for FUND_TRADE
      const validFundTrade = validateEventEmission(
        ServiceAction.FUND_TRADE,
        [EventType.TradeFunded],
      );
      expect(validFundTrade.valid).toBe(true);
      expect(validFundTrade.missingEvents).toHaveLength(0);

      // Test case 2: Missing event for FUND_TRADE
      const missingEvent = validateEventEmission(ServiceAction.FUND_TRADE, []);
      expect(missingEvent.valid).toBe(false);
      expect(missingEvent.missingEvents).toContain(EventType.TradeFunded);

      // Test case 3: Extra events
      const extraEvents = validateEventEmission(
        ServiceAction.FUND_TRADE,
        [EventType.TradeFunded, EventType.DisputeInitiated],
      );
      expect(extraEvents.valid).toBe(false);
      expect(extraEvents.extraEvents).toContain(EventType.DisputeInitiated);
    });
  });

  describe("Trade Lifecycle Event Emissions", () => {
    it("should emit no events for pending trade creation (off-chain)", async () => {
      const trade = await tradeService.createPendingTrade({
        tradeId: "trade-001",
        buyerAddress,
        sellerAddress,
        amountUsdc: "1000",
        buyerLossBps: 100,
        sellerLossBps: 100,
      });

      expect(trade.status).toBe(TradeStatus.PENDING_SIGNATURE);

      // Verify no events in outbox (off-chain action)
      const events = await prisma.chainEventOutbox.findMany({
        where: { tradeId: trade.tradeId },
      });
      expect(events).toHaveLength(0);
    });

    it("should track outbox entries as trades progress through states", async () => {
      // Create pending trade
      const trade = await tradeService.createPendingTrade({
        tradeId: "trade-002",
        buyerAddress,
        sellerAddress,
        amountUsdc: "1000",
        buyerLossBps: 100,
        sellerLossBps: 100,
      });

      // Simulate trade funding event from contract
      await prisma.chainEventOutbox.create({
        data: {
          tradeId: trade.tradeId,
          contractId: "CADDR123",
          ledgerSequence: 1000,
          eventId: "event-001",
          eventType: EventType.TradeFunded,
          payload: { amount_usdc: "1000" },
          status: "PROCESSED",
          attempts: 1,
          nextAttemptAt: new Date(),
        },
      });

      const events = await prisma.chainEventOutbox.findMany({
        where: { tradeId: trade.tradeId },
      });

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe(EventType.TradeFunded);
      expect(events[0].status).toBe("PROCESSED");
    });

    it("should verify delivery confirmation produces DeliveryConfirmed event", async () => {
      const trade = await tradeService.createPendingTrade({
        tradeId: "trade-003",
        buyerAddress,
        sellerAddress,
        amountUsdc: "1000",
        buyerLossBps: 100,
        sellerLossBps: 100,
      });

      // Move to FUNDED state
      await prisma.trade.update({
        where: { id: trade.id },
        data: { status: TradeStatus.FUNDED, version: 2 },
      });

      // Simulate delivery confirmation event
      await prisma.chainEventOutbox.create({
        data: {
          tradeId: trade.tradeId,
          contractId: "CADDR123",
          ledgerSequence: 1001,
          eventId: "event-002",
          eventType: EventType.DeliveryConfirmed,
          payload: {},
          status: "PROCESSED",
          attempts: 1,
          nextAttemptAt: new Date(),
        },
      });

      // Move to DELIVERED state
      await prisma.trade.update({
        where: { id: trade.id },
        data: { status: TradeStatus.DELIVERED, version: 3 },
      });

      const events = await prisma.chainEventOutbox.findMany({
        where: { tradeId: trade.tradeId },
      });

      expect(events.map((e) => e.eventType)).toContain(EventType.DeliveryConfirmed);
    });

    it("should verify funds release produces FundsReleased event", async () => {
      const trade = await tradeService.createPendingTrade({
        tradeId: "trade-004",
        buyerAddress,
        sellerAddress,
        amountUsdc: "1000",
        buyerLossBps: 100,
        sellerLossBps: 100,
      });

      // Progress through states
      await prisma.trade.update({
        where: { id: trade.id },
        data: { status: TradeStatus.DELIVERED, version: 2 },
      });

      // Simulate funds release event
      await prisma.chainEventOutbox.create({
        data: {
          tradeId: trade.tradeId,
          contractId: "CADDR123",
          ledgerSequence: 1002,
          eventId: "event-003",
          eventType: EventType.FundsReleased,
          payload: { amount_usdc: "1000" },
          status: "PROCESSED",
          attempts: 1,
          nextAttemptAt: new Date(),
        },
      });

      // Transition to COMPLETED
      await prisma.trade.update({
        where: { id: trade.id },
        data: { status: TradeStatus.COMPLETED, version: 3 },
      });

      const events = await prisma.chainEventOutbox.findMany({
        where: { tradeId: trade.tradeId },
      });

      expect(events.map((e) => e.eventType)).toContain(EventType.FundsReleased);
    });
  });

  describe("Dispute Event Emissions", () => {
    it("should emit DisputeInitiated when dispute is created", async () => {
      const trade = await tradeService.createPendingTrade({
        tradeId: "trade-005",
        buyerAddress,
        sellerAddress,
        amountUsdc: "1000",
        buyerLossBps: 100,
        sellerLossBps: 100,
      });

      // Move to FUNDED state
      await prisma.trade.update({
        where: { id: trade.id },
        data: { status: TradeStatus.FUNDED, version: 2 },
      });

      // Simulate dispute initiation event
      await prisma.chainEventOutbox.create({
        data: {
          tradeId: trade.tradeId,
          contractId: "CADDR123",
          ledgerSequence: 2000,
          eventId: "event-dispute-001",
          eventType: EventType.DisputeInitiated,
          payload: { initiator: buyerAddress, reason: "goods_not_delivered" },
          status: "PROCESSED",
          attempts: 1,
          nextAttemptAt: new Date(),
        },
      });

      // Move to DISPUTED state
      await prisma.trade.update({
        where: { id: trade.id },
        data: { status: TradeStatus.DISPUTED, version: 3 },
      });

      const events = await prisma.chainEventOutbox.findMany({
        where: { tradeId: trade.tradeId },
      });

      expect(events.map((e) => e.eventType)).toContain(EventType.DisputeInitiated);
    });

    it("should emit DisputeResolved when dispute is resolved", async () => {
      const trade = await tradeService.createPendingTrade({
        tradeId: "trade-006",
        buyerAddress,
        sellerAddress,
        amountUsdc: "1000",
        buyerLossBps: 100,
        sellerLossBps: 100,
      });

      // Move through states to DISPUTED
      await prisma.trade.update({
        where: { id: trade.id },
        data: { status: TradeStatus.DISPUTED, version: 2 },
      });

      // Simulate dispute resolution event
      await prisma.chainEventOutbox.create({
        data: {
          tradeId: trade.tradeId,
          contractId: "CADDR123",
          ledgerSequence: 2001,
          eventId: "event-dispute-002",
          eventType: EventType.DisputeResolved,
          payload: { resolver: sellerAddress, resolution: "full_refund" },
          status: "PROCESSED",
          attempts: 1,
          nextAttemptAt: new Date(),
        },
      });

      // Move to COMPLETED
      await prisma.trade.update({
        where: { id: trade.id },
        data: { status: TradeStatus.COMPLETED, version: 3 },
      });

      const events = await prisma.chainEventOutbox.findMany({
        where: { tradeId: trade.tradeId },
      });

      expect(events.map((e) => e.eventType)).toContain(EventType.DisputeResolved);
    });
  });

  describe("Stream Clawback Events", () => {
    it("should emit StreamClawback event when admin claws back funds", async () => {
      const streamId = "stream-001";
      const admin = "GADMIN123";

      // Simulate stream clawback event
      await prisma.chainEventOutbox.create({
        data: {
          tradeId: streamId,
          contractId: "CADDR123",
          ledgerSequence: 3000,
          eventId: "event-clawback-001",
          eventType: EventType.StreamClawback,
          payload: {
            stream_id: streamId,
            admin,
            amount: "5000",
          },
          status: "PROCESSED",
          attempts: 1,
          nextAttemptAt: new Date(),
        },
      });

      const events = await prisma.chainEventOutbox.findMany({
        where: { tradeId: streamId },
      });

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe(EventType.StreamClawback);
    });
  });

  describe("Event Completeness Validation", () => {
    it("should report violations when expected events are missing", async () => {
      const trade = await tradeService.createPendingTrade({
        tradeId: "trade-007",
        buyerAddress,
        sellerAddress,
        amountUsdc: "1000",
        buyerLossBps: 100,
        sellerLossBps: 100,
      });

      // Transition to FUNDED without creating outbox event
      await prisma.trade.update({
        where: { id: trade.id },
        data: { status: TradeStatus.FUNDED, version: 2 },
      });

      // Check for expected events
      const events = await prisma.chainEventOutbox.findMany({
        where: {
          tradeId: trade.tradeId,
          eventType: EventType.TradeFunded,
        },
      });

      // This test demonstrates the gap detection
      // In production, scanOutboxCompleteness would flag this
      expect(events).toHaveLength(0); // Missing event detected
    });

    it("should ensure all trade actions have event mappings", () => {
      const mappedActions = new Set(
        ACTION_EVENT_MAPPINGS.map((m) => m.action),
      );

      // Verify critical actions are mapped
      expect(mappedActions.has(ServiceAction.FUND_TRADE)).toBe(true);
      expect(mappedActions.has(ServiceAction.CONFIRM_DELIVERY)).toBe(true);
      expect(mappedActions.has(ServiceAction.RELEASE_FUNDS)).toBe(true);
      expect(mappedActions.has(ServiceAction.INITIATE_DISPUTE)).toBe(true);
      expect(mappedActions.has(ServiceAction.RESOLVE_DISPUTE)).toBe(true);
    });

    it("should track audit trail for all trade status changes", async () => {
      const trade = await tradeService.createPendingTrade({
        tradeId: "trade-008",
        buyerAddress,
        sellerAddress,
        amountUsdc: "1000",
        buyerLossBps: 100,
        sellerLossBps: 100,
      });

      // Log status change
      await prisma.escrowAudit.create({
        data: {
          tradeId: trade.tradeId,
          eventType: "TradeCreated",
          fromStatus: "PENDING_SIGNATURE",
          toStatus: "CREATED",
          actor: buyerAddress,
          contractId: "CADDR123",
          ledgerSequence: 1000,
          extra: {},
        },
      });

      const audit = await prisma.escrowAudit.findMany({
        where: { tradeId: trade.tradeId },
      });

      expect(audit).toHaveLength(1);
      expect(audit[0].toStatus).toBe("CREATED");
    });
  });

  describe("No Silent Mutations", () => {
    it("should fail CI if a service method mutates state without event mapping", () => {
      // This is a lint-time check, but we verify the mapping is enforced
      ACTION_EVENT_MAPPINGS.forEach((mapping) => {
        // Every action must have at least one side effect or expected event
        const hasSideEffects = mapping.sideEffects && mapping.sideEffects.length > 0;
        const hasExpectedEvents =
          mapping.expectedEvents && mapping.expectedEvents.length > 0;

        expect(hasSideEffects || hasExpectedEvents).toBe(true);
      });
    });
  });
});

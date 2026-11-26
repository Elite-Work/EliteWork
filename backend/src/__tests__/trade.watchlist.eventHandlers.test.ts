import { TradeStatus } from "@prisma/client";
import { handleFundsReleased } from "../services/eventHandlers";
import { EventType, ParsedEvent } from "../types/events";
import { notificationQueue } from "../jobs/queue";

jest.mock("../jobs/queue", () => ({
  notificationQueue: { add: jest.fn().mockResolvedValue({}) },
}));

jest.mock("../services/webhook.service", () => ({
  webhookService: { dispatch: jest.fn() },
}));

jest.mock("../lib/escrowAudit", () => ({
  logEscrowEvent: jest.fn(),
}));

jest.mock("../lib/metrics", () => ({
  recordTradeFunnelEvent: jest.fn(),
  recordTimeToFund: jest.fn(),
  recordTimeToRelease: jest.fn(),
  recordTradeGmv: jest.fn(),
}));

function makeEvent(overrides: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    eventType: EventType.FundsReleased,
    tradeId: "trade-1",
    ledgerSequence: 123,
    contractId: "C-CONTRACT",
    eventId: "evt-1",
    data: { amount_usdc: "100" },
    ...overrides,
  };
}

function makeTx() {
  return {
    trade: {
      findUnique: jest.fn().mockResolvedValue({
        tradeId: "trade-1",
        status: TradeStatus.DELIVERED,
        version: 2,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userWatchlist: {
      findMany: jest.fn().mockResolvedValue([
        { userAddress: "g-watcher-1" },
        { userAddress: "g-watcher-2" },
      ]),
    },
    inAppNotification: {
      create: jest.fn().mockResolvedValue({}),
    },
    notificationPreference: {
      findUnique: jest.fn().mockImplementation(
        async ({ where }: { where: { userAddress: string } }) =>
          where.userAddress === "g-watcher-2"
            ? { preferences: { "trade-released": ["push"] } }
            : null,
      ),
    },
  };
}

describe("watchlist dispatch from the event pipeline (#497)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("notifies every watcher in-app when a watched trade is released", async () => {
    const tx = makeTx();

    await handleFundsReleased(tx as never, makeEvent());

    expect(tx.inAppNotification.create).toHaveBeenCalledTimes(2);
    expect(tx.inAppNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userAddress: "g-watcher-1",
        title: "Trade completed",
        message: expect.stringContaining("trade-1"),
        type: "trade",
        metadata: expect.objectContaining({
          tradeId: "trade-1",
          eventKey: "trade-released",
          status: TradeStatus.COMPLETED,
          eventId: "evt-1",
        }),
      }),
    });
  });

  it("queues push only for watchers who opted into push", async () => {
    const tx = makeTx();

    await handleFundsReleased(tx as never, makeEvent());

    expect(notificationQueue.add).toHaveBeenCalledTimes(1);
    expect(notificationQueue.add).toHaveBeenCalledWith(
      "trade-released-push",
      expect.objectContaining({ userAddress: "g-watcher-2", type: "push" }),
      { jobId: "evt-1:g-watcher-2:push" },
    );
  });

  it("does not fail the chain sync when notification dispatch fails", async () => {
    const tx = makeTx();
    tx.userWatchlist.findMany.mockRejectedValue(new Error("notification db down"));

    await expect(handleFundsReleased(tx as never, makeEvent())).resolves.toBeUndefined();
    expect(tx.trade.updateMany).toHaveBeenCalled();
  });
});

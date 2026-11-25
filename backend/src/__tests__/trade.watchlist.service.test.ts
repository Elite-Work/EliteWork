import {
  Prisma,
  Trade,
  TradeStatus,
  UserWatchlist,
} from "@prisma/client";
import { TradeWatchlistService } from "../services/trade.watchlist.service";
import { notificationQueue } from "../jobs/queue";

jest.mock("../jobs/queue", () => ({
  notificationQueue: { add: jest.fn().mockResolvedValue({}) },
}));

describe("TradeWatchlistService", () => {
  const trade: Trade = {
    id: 1,
    tradeId: "trade-1",
    buyerAddress: "g-user",
    sellerAddress: "g-seller",
    amountUsdc: "100",
    commodity: null,
    buyerLossBps: 5000,
    sellerLossBps: 5000,
    version: 0,
    status: TradeStatus.CREATED,
    fundedAt: null,
    deliveredAt: null,
    completedAt: null,
    expiresAt: null,
    expiredAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  const watch: UserWatchlist = {
    id: 1,
    userAddress: "g-user",
    tradeId: "trade-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  type WatchlistWithTrade = Prisma.UserWatchlistGetPayload<{
    include: { trade: true };
  }>;
  type WatchlistDatabase = ConstructorParameters<typeof TradeWatchlistService>[0];
  const prisma = {
    trade: {
      findUnique: jest.fn<Promise<Trade | null>, [args: Prisma.TradeFindUniqueArgs]>(),
    },
    userWatchlist: {
      upsert: jest.fn<Promise<UserWatchlist>, [args: Prisma.UserWatchlistUpsertArgs]>(),
      deleteMany: jest.fn<
        Promise<Prisma.BatchPayload>,
        [args: Prisma.UserWatchlistDeleteManyArgs]
      >(),
      findMany: jest.fn<
        Promise<WatchlistWithTrade[]>,
        [args: Prisma.UserWatchlistFindManyArgs]
      >(),
    },
    inAppNotification: {
      create: jest.fn().mockResolvedValue({}),
    },
    notificationPreference: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const service = new TradeWatchlistService(
    prisma as unknown as WatchlistDatabase,
  );

  beforeEach(() => jest.clearAllMocks());

  it("adds one user-scoped watch and delegates duplicate prevention to the composite key", async () => {
    prisma.trade.findUnique.mockResolvedValue(trade);
    prisma.userWatchlist.upsert.mockResolvedValue(watch);
    await expect(service.add("trade-1", "G-USER")).resolves.toEqual(watch);
    expect(prisma.userWatchlist.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userAddress_tradeId: { userAddress: "g-user", tradeId: "trade-1" } },
    }));
  });

  it("removes a watch idempotently", async () => {
    prisma.trade.findUnique.mockResolvedValue(trade);
    prisma.userWatchlist.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.remove("trade-1", "g-user")).resolves.toEqual({ removed: false });
  });

  it("lists the caller's watched trades in bookmark order", async () => {
    prisma.userWatchlist.findMany.mockResolvedValue([{ ...watch, trade }]);
    const result = await service.list("G-USER");
    expect(result).toEqual([{ ...trade, watchedAt: watch.createdAt }]);
    expect(prisma.userWatchlist.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userAddress: "g-user" },
    }));
  });

  describe("dispatchTradeNotification (#497)", () => {
    const findWatchers = prisma.userWatchlist.findMany as unknown as jest.Mock;
    const createInApp = prisma.inAppNotification.create as jest.Mock;
    const findPreference = prisma.notificationPreference.findUnique as jest.Mock;

    const update = {
      eventKey: "trade-funded",
      title: "Trade funded",
      message: "Watched trade trade-1 has been funded.",
      metadata: { status: "FUNDED" },
      eventId: "evt-1",
    };

    it("writes an in-app notification for every watcher", async () => {
      findWatchers.mockResolvedValue([
        { userAddress: "g-user" },
        { userAddress: "g-seller" },
      ]);

      const result = await service.dispatchTradeNotification("trade-1", update);

      expect(result).toEqual({ notified: 2, pushQueued: 0 });
      expect(createInApp).toHaveBeenCalledTimes(2);
      expect(createInApp).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userAddress: "g-user",
          title: "Trade funded",
          type: "trade",
          metadata: expect.objectContaining({
            tradeId: "trade-1",
            eventKey: "trade-funded",
            status: "FUNDED",
          }),
        }),
      });
    });

    it("queues push only when that watcher opted into the push channel", async () => {
      findWatchers.mockResolvedValue([
        { userAddress: "g-user" },
        { userAddress: "g-seller" },
      ]);
      findPreference.mockImplementation(async ({ where }: { where: { userAddress: string } }) =>
        where.userAddress === "g-user"
          ? { preferences: { "trade-funded": ["in-app", "push"] } }
          : { preferences: { "trade-funded": ["in-app"] } },
      );

      const result = await service.dispatchTradeNotification("trade-1", update);

      expect(result).toEqual({ notified: 2, pushQueued: 1 });
      expect(notificationQueue.add).toHaveBeenCalledTimes(1);
      expect(notificationQueue.add).toHaveBeenCalledWith(
        "trade-funded-push",
        expect.objectContaining({ userAddress: "g-user", type: "push" }),
        { jobId: "evt-1:g-user:push" },
      );
    });

    it("does not enqueue push when no preferences are stored", async () => {
      findWatchers.mockResolvedValue([{ userAddress: "g-user" }]);
      findPreference.mockResolvedValue(null);

      const result = await service.dispatchTradeNotification("trade-1", update);

      expect(result).toEqual({ notified: 1, pushQueued: 0 });
      expect(notificationQueue.add).not.toHaveBeenCalled();
    });
  });
});

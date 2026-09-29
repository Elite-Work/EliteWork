import { PrismaClient } from "@prisma/client";
import { TradeWatchlistService } from "../services/trade.watchlist.service";

describe("TradeWatchlistService", () => {
  const trade = { tradeId: "trade-1", buyerAddress: "g-user", sellerAddress: "g-seller" };
  const watch = { id: 1, userAddress: "g-user", tradeId: "trade-1", createdAt: new Date() };
  const prisma = {
    trade: { findUnique: jest.fn() },
    userWatchlist: { upsert: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn() },
  };
  const service = new TradeWatchlistService(
    prisma as unknown as Pick<PrismaClient, "trade" | "userWatchlist">,
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
});

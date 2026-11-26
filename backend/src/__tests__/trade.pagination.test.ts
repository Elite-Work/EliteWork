import { Prisma, Trade, TradeStatus } from "@prisma/client";
import { ContractService } from "../services/contract.service";
import { TradeService } from "../services/trade.service";
import { decodeCursor, encodeCursor, InvalidCursorError } from "../lib/cursorPagination";

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 1,
    tradeId: "T1",
    buyerAddress: "buyer",
    sellerAddress: "seller",
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
    ...overrides,
  };
}

type WatchlistEntry = {
  id: number;
  createdAt: Date;
  trade: Trade;
};

function createMockPrisma() {
  return {
    trade: {
      findMany: jest.fn<Promise<Trade[]>, [Prisma.TradeFindManyArgs]>(),
      findFirst: jest.fn<Promise<Trade | null>, [Prisma.TradeFindFirstArgs]>(),
      count: jest.fn<Promise<number>, [Prisma.TradeCountArgs]>(),
    },
    userWatchlist: {
      findMany: jest.fn<Promise<WatchlistEntry[]>, [unknown]>(),
    },
    dispute: {},
    disputeCategory: {},
  };
}

function createService(prisma: ReturnType<typeof createMockPrisma>) {
  return new TradeService(
    prisma as unknown as ConstructorParameters<typeof TradeService>[0],
    {} as unknown as ContractService,
  );
}

describe("TradeService cursor pagination (#502)", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: TradeService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = createService(prisma);
    prisma.userWatchlist.findMany.mockResolvedValue([]);
  });

  it("returns a pageInfo envelope and an extra-row lookahead in cursor mode", async () => {
    prisma.trade.findMany.mockResolvedValue([
      makeTrade({ id: 30, tradeId: "T30" }),
      makeTrade({ id: 29, tradeId: "T29" }),
      makeTrade({ id: 28, tradeId: "T28" }),
      makeTrade({ id: 27, tradeId: "T27" }),
    ]);

    const result = await service.listUserTrades("GA_CALLER", { limit: 3 });

    // limit + 1 rows are requested so `hasNextPage` is accurate.
    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 4 }),
    );
    expect(result).not.toHaveProperty("pagination");
    const page = result as { items: Trade[]; pageInfo: { nextCursor: string | null; hasNextPage: boolean; limit: number } };
    expect(page.items).toHaveLength(3);
    expect(page.pageInfo).toMatchObject({ hasNextPage: true, limit: 3 });
    expect(decodeCursor(page.pageInfo.nextCursor)).toMatchObject({ id: 28 });
  });

  it("anchors the next page to the cursor row instead of an offset", async () => {
    prisma.trade.findMany.mockResolvedValue([makeTrade({ id: 5, tradeId: "T5" })]);

    const cursor = encodeCursor({ id: 10 });
    const result = await service.listUserTrades("GA_CALLER", {
      limit: 1,
      cursor,
    });

    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        cursor: { id: 10 },
        skip: 1,
      }),
    );
    const page = result as { pageInfo: { nextCursor: string | null; hasNextPage: boolean } };
    expect(page.pageInfo.hasNextPage).toBe(false);
    expect(page.pageInfo.nextCursor).toBeNull();
  });

  it("rejects a tampered cursor instead of paging from an arbitrary row", async () => {
    await expect(
      service.listUserTrades("GA_CALLER", { cursor: "not-a-cursor" }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
    expect(prisma.trade.findMany).not.toHaveBeenCalled();
  });

  it("keeps watchlisted trades first and spills into the rest of the list", async () => {
    prisma.userWatchlist.findMany.mockResolvedValue([
      {
        id: 90,
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
        trade: makeTrade({ id: 40, tradeId: "WATCHED" }),
      },
    ]);
    prisma.trade.findMany.mockResolvedValue([
      makeTrade({ id: 20, tradeId: "OTHER-1" }),
      makeTrade({ id: 19, tradeId: "OTHER-2" }),
    ]);

    const result = await service.listUserTrades("GA_CALLER", { limit: 2 });
    const page = result as { items: Trade[]; pageInfo: { nextCursor: string | null } };

    expect(page.items.map((trade) => trade.tradeId)).toEqual(["WATCHED", "OTHER-1"]);
    // The unwatched query must exclude the caller's watched trades.
    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { NOT: { tradeId: { in: ["WATCHED"] } } },
          ]),
        }),
      }),
    );
    expect(decodeCursor(page.pageInfo.nextCursor)).toMatchObject({ id: 20, segment: "unwatched" });
  });

  it("resumes past a watched page using the watchlist row's own ordering key", async () => {
    const watchedAt = new Date("2026-02-01T00:00:00.000Z");
    prisma.userWatchlist.findMany.mockResolvedValue([
      { id: 90, createdAt: watchedAt, trade: makeTrade({ id: 40, tradeId: "WATCHED-1" }) },
      {
        id: 80,
        createdAt: new Date("2026-01-31T00:00:00.000Z"),
        trade: makeTrade({ id: 39, tradeId: "WATCHED-2" }),
      },
    ]);
    prisma.trade.findFirst.mockResolvedValue(makeTrade({ id: 21, tradeId: "OTHER" }));
    prisma.trade.findMany.mockResolvedValue([makeTrade({ id: 21, tradeId: "OTHER" })]);

    const cursor = encodeCursor({
      id: 90,
      sortValue: watchedAt.toISOString(),
      segment: "watched",
    });
    const result = await service.listUserTrades("GA_CALLER", { limit: 2, cursor });
    const page = result as { items: Trade[]; pageInfo: { hasNextPage: boolean } };

    expect(page.items.map((trade) => trade.tradeId)).toEqual(["WATCHED-2", "OTHER"]);
    expect(page.pageInfo.hasNextPage).toBe(false);
  });

  it("keeps the legacy pagination envelope when a page number is supplied", async () => {
    prisma.trade.findMany.mockResolvedValue([makeTrade({ id: 1 })]);
    prisma.trade.count.mockResolvedValue(1);

    const result = await service.listUserTrades("GA_CALLER", { page: 1, limit: 20 });

    expect(result).toMatchObject({
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(result).not.toHaveProperty("pageInfo");
    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
  });
});

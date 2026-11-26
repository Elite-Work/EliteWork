import { Trade, TradeStatus } from "@prisma/client";
import { TradeService } from "../services/trade.service";
import type {
  TradeSearchDocument,
  TradeSearchIndex,
} from "../services/tradeSearch.service";
import { ContractService } from "../services/contract.service";

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

function createSearchIndex(
  ids: string[] | null,
): jest.Mocked<TradeSearchIndex> {
  return {
    searchTradeIds: jest.fn().mockResolvedValue(ids),
    indexTrade: jest.fn().mockResolvedValue(undefined),
  };
}

function createPrismaMock(items: Trade[] = [], total = items.length) {
  return {
    trade: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue(items),
      count: jest.fn().mockResolvedValue(total),
      findFirst: jest.fn(),
    },
    dispute: {},
    disputeCategory: {},
  };
}

function buildService(
  prisma: ReturnType<typeof createPrismaMock>,
  search: TradeSearchIndex,
): TradeService {
  return new TradeService(
    prisma as unknown as ConstructorParameters<typeof TradeService>[0],
    {} as ContractService,
    search,
  );
}

describe("TradeService.listUserTrades — full-text search (#504)", () => {
  it("keeps the caller scope and adds the matched trade ids", async () => {
    const prisma = createPrismaMock([makeTrade()]);
    const search = createSearchIndex(["T1", "T2"]);
    const service = buildService(prisma, search);

    const result = await service.listUserTrades("buyer", { q: "  maize  " });

    expect(search.searchTradeIds).toHaveBeenCalledWith("maize");
    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ buyerAddress: "buyer" }, { sellerAddress: "buyer" }],
          tradeId: { in: ["T1", "T2"] },
        }),
      }),
    );
    expect(result.items).toHaveLength(1);
  });

  it("returns an empty page without querying when nothing matches", async () => {
    const prisma = createPrismaMock();
    const search = createSearchIndex([]);
    const service = buildService(prisma, search);

    const result = await service.listUserTrades("buyer", { q: "cocoa" });

    expect(result).toEqual({
      items: [],
      pageInfo: { nextCursor: null, hasNextPage: false, limit: 20 },
    });
    expect(prisma.trade.findMany).not.toHaveBeenCalled();
    expect(prisma.trade.count).not.toHaveBeenCalled();
  });

  it("falls back to a substring filter on commodity/tradeId when the index is down", async () => {
    const prisma = createPrismaMock([makeTrade({ commodity: "Maize" })]);
    const search = createSearchIndex(null);
    const service = buildService(prisma, search);

    await service.listUserTrades("buyer", { q: "mai" });

    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              OR: [
                { commodity: { contains: "mai", mode: "insensitive" } },
                { tradeId: { contains: "mai", mode: "insensitive" } },
              ],
            },
          ],
        }),
      }),
    );
  });

  it("does not touch the index when no query is supplied", async () => {
    const prisma = createPrismaMock([makeTrade()]);
    const search = createSearchIndex(null);
    const service = buildService(prisma, search);

    await service.listUserTrades("buyer", { status: TradeStatus.CREATED });

    expect(search.searchTradeIds).not.toHaveBeenCalled();
    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ buyerAddress: "buyer" }, { sellerAddress: "buyer" }],
          status: TradeStatus.CREATED,
        },
      }),
    );
  });

  it("applies the query to watchlisted trades too", async () => {
    const prisma = createPrismaMock([]);
    const search = createSearchIndex(["T9"]);
    const watchlist = {
      findMany: jest.fn().mockResolvedValue([
        { trade: makeTrade({ tradeId: "T7", commodity: "Rice" }) },
        { trade: makeTrade({ tradeId: "T9", commodity: "Maize" }) },
      ]),
    };
    const service = buildService(
      { ...prisma, userWatchlist: watchlist } as unknown as ReturnType<
        typeof createPrismaMock
      >,
      search,
    );

    const result = await service.listUserTrades("buyer", { q: "maize" });

    expect(result.items.map((trade) => trade.tradeId)).toEqual(["T9"]);
  });
});

describe("TradeService.createPendingTrade — search indexing (#504)", () => {
  it("indexes the new trade with its commodity", async () => {
    const created = makeTrade({ tradeId: "T42", commodity: "Maize" });
    const prisma = createPrismaMock();
    prisma.trade.create.mockResolvedValue(created);
    const search = createSearchIndex(null);
    const service = buildService(prisma, search);

    await service.createPendingTrade({
      tradeId: "T42",
      buyerAddress: "buyer",
      sellerAddress: "seller",
      amountUsdc: "100",
      buyerLossBps: 5000,
      sellerLossBps: 5000,
      commodity: "Maize",
    });

    const document: TradeSearchDocument = search.indexTrade.mock.calls[0][0];
    expect(document).toEqual({
      tradeId: "T42",
      buyerAddress: "buyer",
      sellerAddress: "seller",
      commodity: "Maize",
    });
  });
});

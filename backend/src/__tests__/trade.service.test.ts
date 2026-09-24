import { Prisma, Trade, TradeStatus } from "@prisma/client";
import { ContractService } from "../services/contract.service";
import { TradeAccessDeniedError, TradeService } from "../services/trade.service";

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 1,
    tradeId: "T1",
    buyerAddress: "buyer",
    sellerAddress: "seller",
    amountUsdc: "100",
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

type TradeStatsRow = Prisma.TradeGetPayload<{
  select: { amountUsdc: true; status: true };
}>;

type TradePrismaMock = {
  trade: {
    create: jest.MockedFunction<
      (args: Prisma.TradeCreateArgs) => Promise<Trade>
    >;
    findMany: jest.MockedFunction<
      (args: Prisma.TradeFindManyArgs) => Promise<Trade[] | TradeStatsRow[]>
    >;
    count: jest.MockedFunction<
      (args: Prisma.TradeCountArgs) => Promise<number>
    >;
    findFirst: jest.MockedFunction<
      (args: Prisma.TradeFindFirstArgs) => Promise<Trade | null>
    >;
  };
};

function createMockPrisma(): TradePrismaMock {
  return {
    trade: {
      create: jest.fn<Promise<Trade>, [args: Prisma.TradeCreateArgs]>(),
      findMany: jest.fn<
        Promise<Trade[] | TradeStatsRow[]>,
        [args: Prisma.TradeFindManyArgs]
      >(),
      count: jest.fn<Promise<number>, [args: Prisma.TradeCountArgs]>(),
      findFirst: jest.fn<Promise<Trade | null>, [args: Prisma.TradeFindFirstArgs]>(),
    },
  };
}

function asTradeDatabase(
  mock: TradePrismaMock,
): ConstructorParameters<typeof TradeService>[0] {
  return mock as unknown as ConstructorParameters<typeof TradeService>[0];
}

type MockContractService = jest.Mocked<
  Pick<ContractService, "buildInitiateDisputeTx">
>;

function createMockContractService(): MockContractService {
  return {
    buildInitiateDisputeTx: jest.fn<
      ReturnType<ContractService["buildInitiateDisputeTx"]>,
      Parameters<ContractService["buildInitiateDisputeTx"]>
    >(),
  };
}

function asContractService(mock: MockContractService): ContractService {
  return mock as unknown as ContractService;
}

describe("TradeService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: TradeService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new TradeService(
      asTradeDatabase(prisma),
      asContractService(createMockContractService()),
    );
  });

  it("stores a pending trade with PENDING_SIGNATURE status", async () => {
    prisma.trade.create.mockResolvedValue(makeTrade());

    await service.createPendingTrade({
      tradeId: "4294967297",
      buyerAddress: "buyer-address",
      sellerAddress: "seller-address",
      amountUsdc: "15.5000000",
      buyerLossBps: 5000,
      sellerLossBps: 5000,
    });

    expect(prisma.trade.create).toHaveBeenCalledWith({
      data: {
        tradeId: "4294967297",
        buyerAddress: "buyer-address",
        sellerAddress: "seller-address",
        amountUsdc: "15.5000000",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
        status: TradeStatus.PENDING_SIGNATURE,
      },
    });
  });

  it("GET /trades returns only caller's trades", async () => {
    prisma.trade.findMany.mockResolvedValue([
      makeTrade({
        id: 1,
        tradeId: "T1",
        buyerAddress: "GA_CALLER",
        sellerAddress: "GA_SELLER",
        amountUsdc: "100",
        status: TradeStatus.CREATED,
      }),
    ]);
    prisma.trade.count.mockResolvedValue(1);

    const result = await service.listUserTrades("GA_CALLER", {
      page: 1,
      limit: 20,
      sort: "createdAt:desc",
    });

    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ buyerAddress: "GA_CALLER" }, { sellerAddress: "GA_CALLER" }],
        },
      })
    );
    expect(result.items).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
  });

  it("GET /trades?status=FUNDED filters correctly", async () => {
    prisma.trade.findMany.mockResolvedValue([
      makeTrade({
        id: 2,
        tradeId: "T2",
        buyerAddress: "GA_CALLER",
        sellerAddress: "GA_S2",
        amountUsdc: "200",
        status: TradeStatus.FUNDED,
      }),
    ]);
    prisma.trade.count.mockResolvedValue(1);

    await service.listUserTrades("GA_CALLER", {
      status: TradeStatus.FUNDED,
      page: 1,
      limit: 20,
      sort: "createdAt:desc",
    });

    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ buyerAddress: "GA_CALLER" }, { sellerAddress: "GA_CALLER" }],
          status: TradeStatus.FUNDED,
        },
      })
    );
  });

  it("uses a stable default order with an id tie-breaker", async () => {
    prisma.trade.findMany.mockResolvedValue([]);
    prisma.trade.count.mockResolvedValue(0);

    await service.listUserTrades("GA_CALLER", {
      page: 1,
      limit: 20,
    });

    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: 0,
        take: 20,
      })
    );
  });

  it("keeps custom pagination sorts deterministic under identical sort values", async () => {
    prisma.trade.findMany.mockResolvedValue([]);
    prisma.trade.count.mockResolvedValue(0);

    await service.listUserTrades("GA_CALLER", {
      page: 2,
      limit: 5,
      sort: "createdAt:asc",
    });

    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: 5,
        take: 5,
      })
    );
  });

  it("falls back to stable default ordering for unsupported sort fields", async () => {
    prisma.trade.findMany.mockResolvedValue([]);
    prisma.trade.count.mockResolvedValue(0);

    await service.listUserTrades("GA_CALLER", {
      sort: "randomField:asc",
    });

    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    );
  });

  it("GET /trades/:id returns 403 if caller is not party", async () => {
    prisma.trade.findFirst.mockResolvedValue(
      makeTrade({
        id: 10,
        tradeId: "T10",
        buyerAddress: "GA_A",
        sellerAddress: "GA_B",
        amountUsdc: "900",
        status: TradeStatus.CREATED,
      }),
    );

    await expect(service.getTradeById("10", "GA_NOT_PARTY")).rejects.toBeInstanceOf(
      TradeAccessDeniedError
    );
  });

  it("GET /trades/stats returns correct counts and volume", async () => {
    prisma.trade.findMany.mockResolvedValue([
      { amountUsdc: "100", status: TradeStatus.PENDING_SIGNATURE },
      { amountUsdc: "25.5", status: TradeStatus.FUNDED },
      { amountUsdc: "50", status: TradeStatus.COMPLETED },
    ]);

    const stats = await service.getUserStats("GA_CALLER");

    expect(stats.totalTrades).toBe(3);
    // Issue #178: volume is an exact decimal string, not a float.
    expect(stats.totalVolume).toBe("175.5000000");
    expect(stats.openTrades).toBe(2);
  });
});

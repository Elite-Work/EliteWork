import { PrismaClient, TradeStatus } from "@prisma/client";
import { TradeService } from "../services/trade.service";

function createMockPrisma() {
  return {
    trade: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  } as unknown as PrismaClient;
}

describe("TradeService.listCooperativeTrades (issue #44)", () => {
  it("scopes the query to member wallets with pagination", async () => {
    const prisma = createMockPrisma();
    const service = new TradeService(prisma, {} as any);
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([{ tradeId: "t-1" }]);
    (prisma.trade.count as jest.Mock).mockResolvedValue(1);

    const result = await service.listCooperativeTrades(["ga_member_a", "ga_member_b"], {
      page: 1,
      limit: 20,
    });

    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { buyerAddress: { in: ["ga_member_a", "ga_member_b"] } },
            { sellerAddress: { in: ["ga_member_a", "ga_member_b"] } },
          ],
        }),
        skip: 0,
        take: 20,
      }),
    );
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it("applies an optional status filter", async () => {
    const prisma = createMockPrisma();
    const service = new TradeService(prisma, {} as any);
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.trade.count as jest.Mock).mockResolvedValue(0);

    await service.listCooperativeTrades(["ga_member"], { status: TradeStatus.DISPUTED });

    expect(prisma.trade.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: TradeStatus.DISPUTED }),
    });
  });
});

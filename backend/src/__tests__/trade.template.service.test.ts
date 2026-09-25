import { Prisma, Trade, TradeStatus, TradeTemplate } from "@prisma/client";
import { ContractService } from "../services/contract.service";
import {
  TradeTemplateNotFoundError,
  TradeTemplateService,
} from "../services/trade.template.service";

describe("TradeTemplateService", () => {
  const userAddress = "g-user";
  const template: TradeTemplate = {
    id: 7,
    userAddress,
    name: "Weekly maize sale",
    sellerAddress: "g-seller",
    amountUsdc: "125.50",
    buyerLossBps: 5000,
    sellerLossBps: 5000,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  const createdTrade: Trade = {
    id: 8,
    tradeId: "trade-1",
    buyerAddress: userAddress,
    sellerAddress: "g-seller",
    amountUsdc: "125.50",
    buyerLossBps: 5000,
    sellerLossBps: 5000,
    version: 0,
    status: TradeStatus.PENDING_SIGNATURE,
    fundedAt: null,
    deliveredAt: null,
    completedAt: null,
    expiresAt: null,
    expiredAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  type TemplateDatabase = ConstructorParameters<typeof TradeTemplateService>[0];
  const prisma = {
    tradeTemplate: {
      upsert: jest.fn<Promise<TradeTemplate>, [args: Prisma.TradeTemplateUpsertArgs]>(),
      findMany: jest.fn<Promise<TradeTemplate[]>, [args: Prisma.TradeTemplateFindManyArgs]>(),
      findFirst: jest.fn<Promise<TradeTemplate | null>, [args: Prisma.TradeTemplateFindFirstArgs]>(),
    },
    trade: {
      create: jest.fn<Promise<Trade>, [args: Prisma.TradeCreateArgs]>(),
    },
  };
  const contract: jest.Mocked<Pick<ContractService, "buildCreateTradeTx">> = {
    buildCreateTradeTx: jest.fn<
      ReturnType<ContractService["buildCreateTradeTx"]>,
      Parameters<ContractService["buildCreateTradeTx"]>
    >(),
  };
  const service = new TradeTemplateService(
    prisma as unknown as TemplateDatabase,
    contract as unknown as ContractService,
  );

  beforeEach(() => jest.clearAllMocks());

  it("saves a user-scoped template", async () => {
    prisma.tradeTemplate.upsert.mockResolvedValue(template);
    await expect(service.save("G-USER", template)).resolves.toEqual(template);
    expect(prisma.tradeTemplate.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userAddress_name: { userAddress, name: template.name } },
    }));
  });

  it("lists only the caller's templates", async () => {
    prisma.tradeTemplate.findMany.mockResolvedValue([template]);
    await expect(service.list("G-USER")).resolves.toEqual([template]);
    expect(prisma.tradeTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userAddress },
    }));
  });

  it("creates a pending trade from a saved template", async () => {
    prisma.tradeTemplate.findFirst.mockResolvedValue(template);
    contract.buildCreateTradeTx.mockResolvedValue({ tradeId: "trade-1", unsignedXdr: "xdr" });
    prisma.trade.create.mockResolvedValue(createdTrade);

    await expect(service.createTradeFromTemplate(7, "G-USER")).resolves.toEqual({
      tradeId: "trade-1", unsignedXdr: "xdr", templateId: 7,
    });
    expect(prisma.trade.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tradeId: "trade-1",
        buyerAddress: userAddress,
        status: TradeStatus.PENDING_SIGNATURE,
      }),
    });
  });

  it("does not expose another user's missing template", async () => {
    prisma.tradeTemplate.findFirst.mockResolvedValue(null);
    await expect(service.createTradeFromTemplate(404, userAddress)).rejects.toBeInstanceOf(
      TradeTemplateNotFoundError,
    );
  });
});

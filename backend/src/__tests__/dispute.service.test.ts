import {
  Dispute,
  DisputeStatus,
  Prisma,
  Trade,
  TradeStatus,
} from "@prisma/client";
import { TradeService, DisputeTradeStatusError, TradeAccessDeniedError } from "../services/trade.service";
import { ContractService } from "../services/contract.service";

type CategoryIdRow = Prisma.DisputeCategoryGetPayload<{
    select: { id: true };
}>;

type TradePrismaMock = {
    trade: {
        findFirst: jest.MockedFunction<
            (args: Prisma.TradeFindFirstArgs) => Promise<Trade | null>
        >;
        findUnique: jest.MockedFunction<
            (args: Prisma.TradeFindUniqueArgs) => Promise<Trade | null>
        >;
    };
    dispute: {
        create: jest.MockedFunction<
            (args: Prisma.DisputeCreateArgs) => Promise<Dispute>
        >;
    };
    disputeCategory: {
        findFirst: jest.MockedFunction<
            (args: Prisma.DisputeCategoryFindFirstArgs) =>
                Promise<CategoryIdRow | null>
        >;
    };
};

function createMockPrisma(): TradePrismaMock {
    return {
        trade: {
            findFirst: jest.fn<
                Promise<Trade | null>,
                [args: Prisma.TradeFindFirstArgs]
            >(),
            findUnique: jest.fn<
                Promise<Trade | null>,
                [args: Prisma.TradeFindUniqueArgs]
            >(),
        },
        dispute: {
            create: jest.fn<
                Promise<Dispute>,
                [args: Prisma.DisputeCreateArgs]
            >(),
        },
        disputeCategory: {
            findFirst: jest.fn<
                Promise<CategoryIdRow | null>,
                [args: Prisma.DisputeCategoryFindFirstArgs]
            >(),
        },
    };
}

type TradeDatabase = ConstructorParameters<typeof TradeService>[0];

function asTradeDatabase(mock: TradePrismaMock): TradeDatabase {
    return mock as unknown as TradeDatabase;
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

function makeTrade(overrides: Partial<Trade> = {}): Trade {
    return {
        id: 1,
        tradeId: "T123",
        buyerAddress: "GA_BUYER",
        sellerAddress: "GA_SELLER",
        amountUsdc: "100",
        buyerLossBps: 5000,
        sellerLossBps: 5000,
        version: 0,
        status: TradeStatus.FUNDED,
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

function makeDispute(overrides: Partial<Dispute> = {}): Dispute {
    return {
        id: 1,
        tradeId: "T123",
        initiator: "GA_BUYER",
        reason: "Reason string",
        status: DisputeStatus.OPEN,
        version: 0,
        resolvedAt: null,
        categoryId: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        ...overrides,
    };
}

describe("TradeService - initiateDispute", () => {
    let prisma: ReturnType<typeof createMockPrisma>;
    let contractService: ReturnType<typeof createMockContractService>;
    let service: TradeService;

    beforeEach(() => {
        prisma = createMockPrisma();
        contractService = createMockContractService();
        service = new TradeService(
            asTradeDatabase(prisma),
            asContractService(contractService),
        );
    });

    const mockTrade = makeTrade();

    it("successfully initiates a dispute for a FUNDED trade", async () => {
        prisma.trade.findFirst.mockResolvedValue(mockTrade);
        prisma.disputeCategory.findFirst.mockResolvedValue({ id: 7 });
        contractService.buildInitiateDisputeTx.mockResolvedValue({ unsignedXdr: "mock-xdr" });
        prisma.dispute.create.mockResolvedValue(makeDispute());

        const result = await service.initiateDispute("T123", "GA_BUYER", "Reason string", "Category string");

        expect(result.unsignedXdr).toBe("mock-xdr");
        expect(contractService.buildInitiateDisputeTx).toHaveBeenCalledWith({
            tradeId: "T123",
            initiatorAddress: "GA_BUYER",
            reasonHash: expect.any(String),
        });
        expect(prisma.dispute.create).toHaveBeenCalledWith({
            data: {
                tradeId: "T123",
                initiator: "GA_BUYER",
                reason: "Reason string",
                status: DisputeStatus.OPEN,
                categoryId: 7,
            },
        });
    });

    it("successfully initiates a dispute for a DELIVERED trade", async () => {
        prisma.trade.findFirst.mockResolvedValue(
            makeTrade({ status: TradeStatus.DELIVERED }),
        );
        prisma.disputeCategory.findFirst.mockResolvedValue({ id: 7 });
        contractService.buildInitiateDisputeTx.mockResolvedValue({ unsignedXdr: "mock-xdr" });

        await service.initiateDispute("T123", "GA_SELLER", "Reason string", "Category string");

        expect(contractService.buildInitiateDisputeTx).toHaveBeenCalled();
    });

    it("stores a validated category id when categoryId is provided", async () => {
        prisma.trade.findFirst.mockResolvedValue(mockTrade);
        prisma.disputeCategory.findFirst.mockResolvedValue({ id: 12 });
        contractService.buildInitiateDisputeTx.mockResolvedValue({ unsignedXdr: "mock-xdr" });
        prisma.dispute.create.mockResolvedValue(makeDispute());

        await service.initiateDispute("T123", "GA_BUYER", "Reason string", "", 12);

        expect(prisma.disputeCategory.findFirst).toHaveBeenCalledWith({
            where: { id: 12, isActive: true },
            select: { id: true },
        });
        expect(prisma.dispute.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ categoryId: 12 }),
        });
    });

    it("rejects an unknown or inactive dispute category before building the contract transaction", async () => {
        prisma.trade.findFirst.mockResolvedValue(mockTrade);
        prisma.disputeCategory.findFirst.mockResolvedValue(null);

        await expect(
            service.initiateDispute("T123", "GA_BUYER", "Reason string", "unknown")
        ).rejects.toThrow("Invalid dispute category: unknown");

        expect(contractService.buildInitiateDisputeTx).not.toHaveBeenCalled();
        expect(prisma.dispute.create).not.toHaveBeenCalled();
    });

    it("throws DisputeTradeStatusError if trade is in CREATED status", async () => {
        prisma.trade.findFirst.mockResolvedValue(
            makeTrade({ status: TradeStatus.CREATED }),
        );

        await expect(
            service.initiateDispute("T123", "GA_BUYER", "Reason", "Category")
        ).rejects.toThrow(DisputeTradeStatusError);
    });

    it("throws TradeAccessDeniedError if caller is not buyer or seller", async () => {
        prisma.trade.findFirst.mockResolvedValue(mockTrade);

        await expect(
            service.initiateDispute("T123", "GA_OTHER", "Reason", "Category")
        ).rejects.toThrow(TradeAccessDeniedError);
    });

    it("throws error if trade is not found", async () => {
        prisma.trade.findFirst.mockResolvedValue(null);

        await expect(
            service.initiateDispute("T999", "GA_BUYER", "Reason", "Category")
        ).rejects.toThrow("Trade not found");
    });
});

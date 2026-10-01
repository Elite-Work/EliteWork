import { PrismaClient, TradeStatus } from "@prisma/client";
import { TradeEvidenceListService } from "../services/trade.evidence.service";
import { IPFSService } from "../services/ipfs.service";

describe("TradeEvidenceListService", () => {
  const now = new Date("2026-06-24T12:00:00.000Z");
  const trade: Trade = {
    id: 1,
    tradeId: "trade-1",
    buyerAddress: "g-buyer",
    sellerAddress: "g-seller",
    amountUsdc: "100",
    buyerLossBps: 5000,
    sellerLossBps: 5000,
    version: 0,
    status: TradeStatus.DISPUTED,
    fundedAt: null,
    deliveredAt: null,
    completedAt: null,
    expiresAt: null,
    expiredAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const ipfs = { getSignedFileUrl: jest.fn() };
  const service = new TradeEvidenceListService(
    prisma as unknown as Pick<PrismaClient, "trade" | "dispute" | "tradeEvidence" | "deliveryManifest">,
    ipfs as unknown as IPFSService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.trade.findUnique.mockResolvedValue(trade);
    prisma.dispute.findUnique.mockResolvedValue(dispute);
    ipfs.getSignedFileUrl.mockReturnValue({
      url: "https://gateway.example/ipfs/bafy-video?expires=1&signature=sig",
      expiresAt: new Date(now.getTime() + 300000),
    });
  });

  it("returns signed, expiring video URLs with pagination", async () => {
    prisma.tradeEvidence.findMany.mockResolvedValue([video]);
    prisma.tradeEvidence.count.mockResolvedValue(1);
    const result = await service.list("trade-1", "g-buyer", { type: "video", page: 1, limit: 1 });
    expect(result.items[0]).toEqual(expect.objectContaining({
      type: "video",
      downloadUrl: expect.stringContaining("signature=sig"),
      expiresAt: expect.any(Date),
    }));
    expect(result.pagination).toEqual({ page: 1, limit: 1, total: 1, totalPages: 1 });
  });

  it("filters to the manifest and handles a dispute with no evidence", async () => {
    prisma.deliveryManifest.findUnique.mockResolvedValue(null);
    await expect(service.list("trade-1", "g-buyer", { type: "manifest", page: 1, limit: 20 }))
      .resolves.toMatchObject({ items: [], pagination: { total: 0 } });
  });
});

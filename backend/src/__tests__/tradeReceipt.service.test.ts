import { buildOnChainRecordUrl, generateTradeReceiptPdf } from "../services/tradeReceipt.service";

describe("buildOnChainRecordUrl", () => {
  it("links to the transaction on stellar.expert when a txHash is known", () => {
    const url = buildOnChainRecordUrl({ tradeId: "T-1", txHash: "abc123" }, "testnet");
    expect(url).toBe("https://stellar.expert/explorer/testnet/tx/abc123");
  });

  it("falls back to a search link by tradeId when there is no txHash yet", () => {
    const url = buildOnChainRecordUrl({ tradeId: "T-1", txHash: null }, "testnet");
    expect(url).toBe("https://stellar.expert/explorer/testnet/search?term=T-1");
  });

  it("uses the public explorer path for mainnet", () => {
    const url = buildOnChainRecordUrl({ tradeId: "T-1", txHash: "abc123" }, "mainnet");
    expect(url).toBe("https://stellar.expert/explorer/public/tx/abc123");
  });
});

describe("generateTradeReceiptPdf", () => {
  it("produces a non-empty PDF buffer", async () => {
    const pdf = await generateTradeReceiptPdf({
      tradeId: "T-1",
      buyerAddress: "GBUYERADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      sellerAddress: "GSELLERADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      amountUsdc: "1000",
      status: "COMPLETED",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      completedAt: new Date("2026-01-05T00:00:00.000Z"),
      txHash: "deadbeef",
    });

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(0);
    // PDF files start with the "%PDF-" magic header.
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("still produces a valid PDF when there is no on-chain txHash yet", async () => {
    const pdf = await generateTradeReceiptPdf({
      tradeId: "T-2",
      buyerAddress: "GBUYERADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      sellerAddress: "GSELLERADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      amountUsdc: "250",
      status: "CREATED",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      txHash: null,
    });

    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});

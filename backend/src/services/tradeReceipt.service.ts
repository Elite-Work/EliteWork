import PDFDocument from "pdfkit";
import QRCode from "qrcode";

/**
 * Minimal shape of a trade needed to render a receipt — deliberately a
 * subset of the Prisma `Trade` model so this stays testable without a DB.
 */
export interface TradeReceiptData {
  tradeId: string;
  buyerAddress: string;
  sellerAddress: string;
  amountUsdc: string;
  status: string;
  createdAt: Date;
  completedAt?: Date | null;
  /** Soroban transaction hash of the trade's on-chain settlement, if any. */
  txHash?: string | null;
}

const STELLAR_EXPERT_BASE: Record<"mainnet" | "testnet", string> = {
  mainnet: "https://stellar.expert/explorer/public",
  testnet: "https://stellar.expert/explorer/testnet",
};

/**
 * Builds the URL a QR code on the receipt should point to: the on-chain
 * transaction if we have one recorded, otherwise a fallback page that at
 * least identifies the trade so it can be looked up later.
 */
export function buildOnChainRecordUrl(
  trade: Pick<TradeReceiptData, "tradeId" | "txHash">,
  network: "mainnet" | "testnet" = "testnet",
): string {
  const base = STELLAR_EXPERT_BASE[network];
  return trade.txHash ? `${base}/tx/${trade.txHash}` : `${base}/search?term=${encodeURIComponent(trade.tradeId)}`;
}

function formatUsdc(amountUsdc: string): string {
  const value = Number(amountUsdc);
  return Number.isFinite(value) ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : amountUsdc;
}

function truncateAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-8)}` : address;
}

/**
 * Renders a one-page PDF trade receipt: trade ID, parties, amount, status,
 * and a QR code linking to the on-chain record. Intended for pilot cohort
 * members without reliable smartphone/app access — see the "Public pilot
 * program" item in the README's roadmap and docs/adr for the design
 * rationale.
 */
export async function generateTradeReceiptPdf(
  trade: TradeReceiptData,
  network: "mainnet" | "testnet" = "testnet",
): Promise<Buffer> {
  const onChainUrl = buildOnChainRecordUrl(trade, network);
  const qrDataUrl = await QRCode.toDataURL(onChainUrl, { margin: 1, width: 160 });
  const qrImage = Buffer.from(qrDataUrl.split(",")[1] ?? "", "base64");

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("Trade Receipt", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#666").text("Elite Work — agricultural trade escrow", { align: "center" });
    doc.fillColor("#000");
    doc.moveDown(1.5);

    const row = (label: string, value: string) => {
      doc.fontSize(10).fillColor("#666").text(label, { continued: false });
      doc.fontSize(13).fillColor("#000").text(value);
      doc.moveDown(0.6);
    };

    row("Trade ID", trade.tradeId);
    row("Status", trade.status);
    row("Amount", formatUsdc(trade.amountUsdc));
    row("Buyer", truncateAddress(trade.buyerAddress));
    row("Seller", truncateAddress(trade.sellerAddress));
    row("Created", trade.createdAt.toISOString());
    if (trade.completedAt) {
      row("Completed", trade.completedAt.toISOString());
    }

    doc.moveDown(1);
    doc.fontSize(10).fillColor("#666").text("Scan to view the on-chain record:");
    doc.moveDown(0.3);
    doc.image(qrImage, { width: 120 });
    doc.moveDown(0.3);
    doc.fontSize(8).fillColor("#999").text(onChainUrl, { link: onChainUrl });

    doc.end();
  });
}

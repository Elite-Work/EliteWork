import { Prisma, PrismaClient, TradeStatus } from "@prisma/client";
import { Response, Router } from "express";
import { z } from "zod";
import { Parser } from "json2csv";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";
import { createWalletRateLimiter } from "../lib/rateLimit";
import { RATE_LIMIT_CONFIG } from "../config/rateLimit";
import { generateTradeReceiptPdf } from "../services/tradeReceipt.service";

const tradeExportLimiter = createWalletRateLimiter(RATE_LIMIT_CONFIG.tradeExport);

const exportQuerySchema = z.object({
  format: z.enum(["csv", "json", "pdf"]).default("json"),
  status: z.nativeEnum(TradeStatus).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  /** Required when format=pdf — a receipt is for exactly one trade. */
  tradeId: z.string().min(1).optional(),
}).refine(
  (value: {
    dateFrom?: string;
    dateTo?: string;
  }) => !value.dateFrom || !value.dateTo || new Date(value.dateFrom) <= new Date(value.dateTo),
  { message: "dateFrom must be before or equal to dateTo", path: ["dateFrom"] },
).refine(
  (value: { format: string; tradeId?: string }) => value.format !== "pdf" || !!value.tradeId,
  { message: "tradeId is required when format=pdf", path: ["tradeId"] },
);

const csvFields = [
  "tradeId",
  "buyerAddress",
  "sellerAddress",
  "amountUsdc",
  "status",
  "fundedAt",
  "deliveredAt",
  "completedAt",
  "createdAt",
  "updatedAt",
];

function caller(req: AuthRequest, res: Response): string | null {
  const walletAddress = req.user?.walletAddress?.trim();
  if (!walletAddress) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return walletAddress;
}

function buildWhere(walletAddress: string, query: z.infer<typeof exportQuerySchema>): Prisma.TradeWhereInput {
  const where: Prisma.TradeWhereInput = {
    OR: [{ buyerAddress: walletAddress }, { sellerAddress: walletAddress }],
  };

  if (query.status) {
    where.status = query.status;
  }

  if (query.dateFrom || query.dateTo) {
    where.createdAt = {
      ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
      ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
    };
  }

  return where;
}

function serializeTrade(trade: Record<string, unknown>) {
  return {
    tradeId: trade.tradeId,
    buyerAddress: trade.buyerAddress,
    sellerAddress: trade.sellerAddress,
    amountUsdc: trade.amountUsdc,
    status: trade.status,
    fundedAt: trade.fundedAt,
    deliveredAt: trade.deliveredAt,
    completedAt: trade.completedAt,
    createdAt: trade.createdAt,
    updatedAt: trade.updatedAt,
  };
}

export function createTradeExportRouter(prisma: PrismaClient = defaultPrisma) {
  const router = Router();

  router.get(
    "/export",
    authMiddleware,
    tradeExportLimiter,
    validateRequest({ query: exportQuerySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const walletAddress = caller(req, res);
        if (!walletAddress) return;

        const query = req.query as unknown as z.infer<typeof exportQuerySchema>;
        const where = buildWhere(walletAddress, query);

        if (query.format === "pdf") {
          const trade = await prisma.trade.findFirst({
            where: { ...where, tradeId: query.tradeId },
          });
          if (!trade) {
            res.status(404).json({ error: "Trade not found" });
            return;
          }

          const latestPayout = await (prisma as unknown as {
            payoutIntent?: { findFirst: (args: unknown) => Promise<{ txHash: string | null } | null> };
          }).payoutIntent?.findFirst({
            where: { tradeId: trade.tradeId, txHash: { not: null } },
            orderBy: { confirmedAt: "desc" },
          });

          const network = (process.env.STELLAR_NETWORK?.toLowerCase() === "mainnet") ? "mainnet" as const : "testnet" as const;
          const pdf = await generateTradeReceiptPdf(
            {
              tradeId: trade.tradeId,
              buyerAddress: trade.buyerAddress,
              sellerAddress: trade.sellerAddress,
              amountUsdc: trade.amountUsdc,
              status: trade.status,
              createdAt: trade.createdAt,
              completedAt: trade.completedAt,
              txHash: latestPayout?.txHash ?? null,
            },
            network,
          );

          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `attachment; filename="trade-${trade.tradeId}-receipt.pdf"`);
          res.status(200).send(pdf);
          return;
        }

        if (query.format === "csv") {
          const trades = await prisma.trade.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          });
          const rows = trades.map((trade: unknown) => serializeTrade(trade as any));
          const parser = new Parser({ fields: csvFields });
          const csv = parser.parse(rows);
          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          res.setHeader("Content-Disposition", "attachment; filename=\"trades-export.csv\"");
          res.status(200).send(`\ufeff${csv}`);
          return;
        }

        const skip = (query.page - 1) * query.limit;
        const [trades, total] = await Promise.all([
          prisma.trade.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip,
            take: query.limit,
          }),
          prisma.trade.count({ where }),
        ]);

        res.status(200).json({
          items: trades.map((trade: unknown) => serializeTrade(trade as any)),
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages: Math.ceil(total / query.limit),
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export const tradeExportRoutes = createTradeExportRouter();

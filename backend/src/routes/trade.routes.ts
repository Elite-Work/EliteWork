import { PrismaClient, TradeStatus } from "@prisma/client";
import { NextFunction, Response, Router } from "express";
import { TradeController } from "../controllers/trade.controller";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { AuthRequest } from "../services/auth.service";
import { TradeAccessDeniedError, TradeService } from "../services/trade.service";
import { EncryptionService } from "../services/encryption.service";
import { getAdminAllowlistLowercase } from "../lib/accessControl";
import { validateRequest } from "../middleware/validateRequest";
import { idempotencyMiddleware } from "../middleware/idempotency";
import { 
  createTradeSchema, 
  bulkTradeBodySchema,
  tradeIdParamSchema, 
  listTradesQuerySchema, 
  initiateDisputeSchema 
} from "../schemas/trade.schemas";
import { RATE_LIMIT_CONFIG } from "../config/rateLimit";
import { createWalletRateLimiter } from "../lib/rateLimit";
import { CURSOR_DEPRECATION_WARNING, InvalidCursorError } from "../lib/cursorPagination";
import { buildTradeReceiptJson, generateTradeReceiptPdf } from "../services/tradeReceipt.service";

export function createTradeRouter(prisma: PrismaClient = defaultPrisma) {
  const router = Router();
  const tradeService = new TradeService(prisma);
  const tradeController = new TradeController(tradeService);
  const disputeLimiter = createWalletRateLimiter(RATE_LIMIT_CONFIG.dispute);
  const receiptLimiter = createWalletRateLimiter(RATE_LIMIT_CONFIG.tradeExport);

  const requireWalletFromJwt = (req: AuthRequest, res: Response): string | null => {
    const addr = req.user?.walletAddress?.trim();
    if (!addr) {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    }
    return addr;
  };

  router.post(
    "/", 
    authMiddleware, 
    idempotencyMiddleware,
    validateRequest({ body: createTradeSchema }),
    tradeController.createTrade
  );

  router.post(
    "/bulk",
    authMiddleware,
    idempotencyMiddleware,
    validateRequest({ body: bulkTradeBodySchema }),
    tradeController.createBulkTrades
  );

  router.post(
    "/:id/deposit", 
    authMiddleware, 
    idempotencyMiddleware,
    validateRequest({ params: tradeIdParamSchema }),
    tradeController.buildDepositTx
  );

  router.post(
    "/:id/confirm", 
    authMiddleware, 
    validateRequest({ params: tradeIdParamSchema }),
    tradeController.confirmDelivery
  );

  router.post(
    "/:id/release", 
    authMiddleware, 
    idempotencyMiddleware,
    validateRequest({ params: tradeIdParamSchema }),
    tradeController.releaseFunds
  );

  router.post(
    "/:id/dispute", 
    authMiddleware,
    disputeLimiter,
    idempotencyMiddleware,
    validateRequest({ params: tradeIdParamSchema, body: initiateDisputeSchema }),
    tradeController.initiateDispute
  );

  router.get(
    "/", 
    authMiddleware, 
    validateRequest({ query: listTradesQuerySchema }),
    async (req: AuthRequest, res, next: NextFunction) => {
      const callerAddress = requireWalletFromJwt(req, res);
      if (!callerAddress) {
        return;
      }

      try {
        const { status, page, limit, sort, q, cursor } = req.query as any;

        const result = await tradeService.listUserTrades(callerAddress, {
          status,
          page,
          limit,
          sort,
          q,
          cursor,
        });

        // Offset pagination is deprecated now that cursor mode is the default
        // (#502); tell legacy clients to migrate.
        if (cursor === undefined && page !== undefined) {
          res.setHeader("Warning", CURSOR_DEPRECATION_WARNING);
        }

        res.status(200).json(result);
      } catch (error) {
        if (error instanceof InvalidCursorError) {
          res.status(400).json({ error: error.message });
          return;
        }
        return next(error);
      }
    }
  );

  router.get("/stats", authMiddleware, async (req: AuthRequest, res, next: NextFunction) => {
    const callerAddress = requireWalletFromJwt(req, res);
    if (!callerAddress) {
      return;
    }

    try {
      const stats = await tradeService.getUserStats(callerAddress);
      res.status(200).json(stats);
    } catch (error) {
      return next(error);
    }
  });

  router.post(
    "/:id/rotate-key",
    authMiddleware,
    validateRequest({ params: tradeIdParamSchema }),
    async (req: AuthRequest, res, next: NextFunction) => {
      const callerAddress = requireWalletFromJwt(req, res);
      if (!callerAddress) {
        return;
      }

      try {
        const tradeId = req.params.id as string;
        const trade = await prisma.trade.findUnique({ where: { tradeId } });
        if (!trade) {
          res.status(404).json({ error: "Trade not found" });
          return;
        }

        const caller = callerAddress.toLowerCase();
        const isAdmin = getAdminAllowlistLowercase().has(caller);
        const isParty =
          trade.buyerAddress.toLowerCase() === caller ||
          trade.sellerAddress.toLowerCase() === caller;
        if (!isParty && !isAdmin) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }

        const { keyVersion = "v2" } = req.body as { keyVersion?: string };
        const encryptionService = new EncryptionService();

        const notes = await prisma.tradeNote.findMany({
          where: { tradeId },
          select: { id: true, content: true },
        });

        await Promise.all(
          notes.map((note) =>
            prisma.tradeNote.update({
              where: { id: note.id },
              data: { content: encryptionService.rotateCiphertext(note.content, tradeId, keyVersion) },
            }),
          ),
        );

        const manifest = await prisma.deliveryManifest.findUnique({ where: { tradeId } });
        if (manifest) {
          await prisma.deliveryManifest.update({
            where: { tradeId },
            data: {
              driverName: encryptionService.rotateCiphertext(manifest.driverName, tradeId, keyVersion),
              driverIdNumber: encryptionService.rotateCiphertext(manifest.driverIdNumber, tradeId, keyVersion),
              vehicleRegistration: encryptionService.rotateCiphertext(manifest.vehicleRegistration, tradeId, keyVersion),
              routeDescription: encryptionService.rotateCiphertext(manifest.routeDescription, tradeId, keyVersion),
            },
          });
        }

        res.status(200).json({ ok: true, keyVersion });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Trade receipt (#500, #499). Backs the frontend's download button and the
   * mobile share sheet; any party to the trade may fetch it. The receipt is a
   * snapshot of the off-chain record plus a QR/link to the on-chain settlement
   * when one exists — see `tradeReceipt.service.ts`. Defaults to PDF; pass
   * `?format=json` for the machine-readable receipt used by integrations.
   */
  router.get(
    "/:id/receipt",
    authMiddleware,
    receiptLimiter,
    validateRequest({ params: tradeIdParamSchema }),
    async (req: AuthRequest, res, next: NextFunction) => {
      const callerAddress = requireWalletFromJwt(req, res);
      if (!callerAddress) {
        return;
      }

      try {
        const format = String(req.query.format ?? "pdf").toLowerCase();
        if (format !== "pdf" && format !== "json") {
          res.status(400).json({ error: "format must be 'pdf' or 'json'" });
          return;
        }

        const tradeId = req.params.id as string;
        const trade = await tradeService.getTradeById(tradeId, callerAddress);
        if (!trade) {
          res.status(404).json({ error: "Trade not found" });
          return;
        }

        const latestPayout = await (prisma as unknown as {
          payoutIntent?: {
            findFirst: (args: unknown) => Promise<{ txHash: string | null } | null>;
          };
        }).payoutIntent?.findFirst({
          where: { tradeId: trade.tradeId, txHash: { not: null } },
          orderBy: { confirmedAt: "desc" },
        });

        const network =
          process.env.STELLAR_NETWORK?.toLowerCase() === "mainnet" ? "mainnet" : "testnet";
        const receipt = {
          tradeId: trade.tradeId,
          buyerAddress: trade.buyerAddress,
          sellerAddress: trade.sellerAddress,
          amountUsdc: trade.amountUsdc,
          status: trade.status,
          createdAt: trade.createdAt,
          completedAt: trade.completedAt,
          txHash: latestPayout?.txHash ?? null,
        };

        if (format === "json") {
          res.setHeader("Content-Type", "application/json");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="trade-${trade.tradeId}-receipt.json"`,
          );
          res.status(200).json(buildTradeReceiptJson(receipt, network));
          return;
        }

        const pdf = await generateTradeReceiptPdf(receipt, network);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="trade-${trade.tradeId}-receipt.pdf"`,
        );
        res.status(200).send(pdf);
      } catch (error) {
        if (error instanceof TradeAccessDeniedError) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
        next(error);
      }
    }
  );

  router.get(
    "/:id", 
    authMiddleware, 
    validateRequest({ params: tradeIdParamSchema }),
    async (req: AuthRequest, res, next: NextFunction) => {
      const callerAddress = requireWalletFromJwt(req, res);
      if (!callerAddress) {
        return;
      }

      try {
        const id = req.params.id as string;
        const trade = await tradeService.getTradeById(id, callerAddress);
        if (!trade) {
          res.status(404).json({ error: "Trade not found" });
          return;
        }

        res.status(200).json(trade);
      } catch (error) {
        if (error instanceof TradeAccessDeniedError) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
        return next(error);
      }
    }
  );

  return router;
}


export const tradeRoutes = createTradeRouter();

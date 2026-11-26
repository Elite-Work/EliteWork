import { NextFunction, Response, Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { disputeEvidenceQuerySchema } from "../schemas/evidence.schemas";
import { tradeIdParamSchema } from "../schemas/trade.schemas";
import { AuthRequest } from "../services/auth.service";
import {
  DisputeEvidenceAccessDeniedError,
  DisputeEvidenceTradeNotFoundError,
  TradeEvidenceListService,
  TradeNotDisputedError,
} from "../services/trade.evidence.service";

/**
 * OpenAPI path template for the trade evidence listing endpoint.
 * Kept in sync with the route registered below so the OpenAPI coverage
 * test can detect undocumented endpoints in this route group.
 */
export const TRADE_EVIDENCE_OPENAPI_PATH = "/trades/{id}/evidence";

export function createTradeEvidenceRouter(evidence = new TradeEvidenceListService()) {
  const router = Router();

  router.get(
    "/:id/evidence",
    authMiddleware,
    validateRequest({ params: tradeIdParamSchema, query: disputeEvidenceQuerySchema }),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      const callerAddress = req.user?.walletAddress?.trim();
      if (!callerAddress) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      try {
        const { type, page, limit } = req.query as unknown as {
          type?: "video" | "manifest";
          page: number;
          limit: number;
        };
        res.status(200).json(await evidence.list(String(req.params.id), callerAddress, { type, page, limit }));
      } catch (error) {
        if (error instanceof DisputeEvidenceTradeNotFoundError) {
          res.status(404).json({ error: error.message });
          return;
        }
        if (error instanceof DisputeEvidenceAccessDeniedError) {
          res.status(403).json({ error: error.message });
          return;
        }
        if (error instanceof TradeNotDisputedError) {
          res.status(409).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  return router;
}

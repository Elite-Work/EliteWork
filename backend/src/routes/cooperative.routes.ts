import { PrismaClient } from "@prisma/client";
import { NextFunction, Response, Router } from "express";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { AuthRequest } from "../services/auth.service";
import { TradeService } from "../services/trade.service";
import { canViewCooperativeTrades, getCooperativeMembers } from "../lib/cooperativeAccess";
import { validateRequest } from "../middleware/validateRequest";
import { listTradesQuerySchema } from "../schemas/trade.schemas";

import { requireCooperativeMember } from "../middleware/cooperative.middleware";

/**
 * Cooperative pilot routes (issues #43/#44).
 *
 * Cooperative-admins may VIEW (never mutate) every trade touching a member
 * wallet of their cooperative. Global admins (ADMIN_STELLAR_PUBKEYS) may view
 * any cooperative. Membership/admin mapping lives in
 * `lib/cooperativeAccess.ts` until the ADR-006 tables land.
 */
export function createCooperativeRouter(prisma: PrismaClient = defaultPrisma) {
  const router = Router();
  const tradeService = new TradeService(prisma);

  router.get(
    "/:id/trades",
    authMiddleware,
    requireCooperativeMember,
    validateRequest({ query: listTradesQuerySchema }),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const cooperativeId = String(
          Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
        );

        const { status, page, limit, sort } = req.query as any;
        const result = await tradeService.listCooperativeTrades(
          getCooperativeMembers(cooperativeId),
          { status, page, limit, sort },
        );

        res.status(200).json({ cooperativeId: cooperativeId.toLowerCase(), ...result });
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

export const cooperativeRoutes = createCooperativeRouter();

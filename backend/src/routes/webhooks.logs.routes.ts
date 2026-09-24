import { PrismaClient } from "@prisma/client";
import { Response, Router } from "express";
import { z } from "zod";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";
import {
  paginateWithCursor,
  normalizeCursorLimit,
  CURSOR_DEPRECATION_WARNING,
  InvalidCursorError,
} from "../lib/cursorPagination";

const webhookLogsParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, "Webhook ID must be a numeric string"),
});

const webhookLogsQuerySchema = z.object({
  cursor: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

function caller(req: AuthRequest, res: Response): string | null {
  const walletAddress = req.user?.walletAddress?.trim();
  if (!walletAddress) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return walletAddress;
}

export function createWebhookLogsRouter(prisma: PrismaClient = defaultPrisma) {
  const router = Router();

  router.get(
    "/webhooks/:id/logs",
    authMiddleware,
    validateRequest({ params: webhookLogsParamsSchema, query: webhookLogsQuerySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const walletAddress = caller(req, res);
        if (!walletAddress) return;

        const webhookId = Number(req.params.id);
        const { page, limit, cursor } = req.query as unknown as {
          page?: number;
          limit: number;
          cursor?: string;
        };

        const webhook = await prisma.webhook.findUnique({
          where: { id: webhookId },
          select: { userAddress: true },
        });

        if (!webhook) {
          res.status(404).json({ error: "Webhook not found" });
          return;
        }

        if (webhook.userAddress !== walletAddress) {
          res.status(403).json({ error: "Forbidden: you do not own this webhook" });
          return;
        }

        const select = {
          id: true,
          timestamp: true,
          status: true,
          statusCode: true,
          responseBody: true,
        } as const;

        // Legacy offset mode: engaged only when a caller still sends `page`
        // and no `cursor`. New/updated clients should use `cursor` instead.
        if (page !== undefined && !cursor) {
          const skip = (page - 1) * limit;
          const [attempts, total] = await Promise.all([
            prisma.webhookDeliveryAttempt.findMany({
              where: { webhookId },
              orderBy: { timestamp: "desc" },
              skip,
              take: limit,
              select,
            }),
            prisma.webhookDeliveryAttempt.count({ where: { webhookId } }),
          ]);

          res.setHeader("Warning", CURSOR_DEPRECATION_WARNING);
          res.status(200).json({
            attempts,
            pagination: {
              page,
              limit,
              total,
              totalPages: Math.ceil(total / limit),
            },
          });
          return;
        }

        const result = await paginateWithCursor({
          findMany: ({ take, skip, cursor: cur, orderBy }) =>
            prisma.webhookDeliveryAttempt.findMany({
              where: { webhookId },
              select,
              take,
              skip,
              ...(cur ? { cursor: cur } : {}),
              orderBy: orderBy as { timestamp: "desc"; id?: "desc" }[],
            }),
          orderBy: [{ timestamp: "desc" }, { id: "desc" }],
          cursor,
          limit: normalizeCursorLimit(limit),
        });

        res.status(200).json({
          attempts: result.items,
          pageInfo: result.pageInfo,
        });
      } catch (error) {
        if (error instanceof InvalidCursorError) {
          res.status(400).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  return router;
}

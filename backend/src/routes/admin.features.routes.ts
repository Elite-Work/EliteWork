import { PrismaClient } from "@prisma/client";
import { Response, Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware } from "../middleware/admin.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { getTraceContext } from "../middleware/tracing.middleware";
import { AuthRequest } from "../services/auth.service";
import { featureFlagService } from "../services/feature-flags.service";
import { appLogger } from "../middleware/logger";
import { createWalletRateLimiter } from "../lib/rateLimit";
import { RATE_LIMIT_CONFIG } from "../config/rateLimit";
import { prisma as defaultPrisma } from "../lib/db";

const featureNameParamSchema = z.object({
  name: z
    .string()
    .min(1, "Feature name is required")
    .max(100, "Feature name must be at most 100 characters")
    .regex(/^[a-zA-Z0-9._-]+$/, "Feature name must contain only alphanumeric characters, dots, hyphens, or underscores"),
});

const updateFlagBodySchema = z.object({
  enabled: z.boolean(),
  rolloutPercentage: z.number().min(0).max(100).optional(),
});

const adminRateLimit = createWalletRateLimiter(RATE_LIMIT_CONFIG.admin);

export function createAdminFeaturesRouter(prisma: PrismaClient = defaultPrisma) {
  const router = Router();

  router.get(
    "/api/admin/features",
    authMiddleware,
    adminMiddleware,
    adminRateLimit,
    async (_req: AuthRequest, res: Response, next) => {
      try {
        const flags = await featureFlagService.listFlags();
        res.status(200).json({ flags });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    "/api/admin/features/:name",
    authMiddleware,
    adminMiddleware,
    adminRateLimit,
    validateRequest({ params: featureNameParamSchema, body: updateFlagBodySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const name = String(req.params.name);
        const { enabled, rolloutPercentage } = req.body as {
          enabled: boolean;
          rolloutPercentage?: number;
        };

        const flag = await featureFlagService.setFlag(name, {
          enabled,
          rolloutPercentage,
        });

        await prisma.adminActionAudit.create({
          data: {
            action: "UPDATE_FEATURE_FLAG",
            actorAddress: req.user!.walletAddress,
            targetReference: name,
            note: JSON.stringify({ enabled, rolloutPercentage }),
          },
        });

        // Admin audit: record which admin changed a feature flag
        const traceCtx = getTraceContext();
        appLogger.info(
          {
            audit: true,
            eventType: "FEATURE_FLAG_UPDATED",
            actionName: "admin.features.update",
            featureName: name,
            enabled,
            rolloutPercentage: rolloutPercentage ?? null,
            adminAddress: req.user?.walletAddress,
            traceId: traceCtx?.traceId,
            spanId: traceCtx?.spanId,
            timestamp: new Date().toISOString(),
          },
          `[AdminAudit] Feature flag '${name}' set to enabled=${enabled} by ${req.user?.walletAddress}`,
        );
        res.status(200).json({ name, flag });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

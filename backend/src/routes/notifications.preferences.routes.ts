import { PrismaClient } from "@prisma/client";
import { Response, Router } from "express";
import { z } from "zod";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";

const notificationChannelSchema = z.enum(["email", "push", "in-app"]);
const preferencesSchema = z.record(
  z.string().min(1),
  z.array(notificationChannelSchema).max(3),
);

// Derived from the schema so the event-key/channel shape has a single source
// of truth and stays in sync with `preferencesSchema` automatically.
type Preferences = z.infer<typeof preferencesSchema>;

// Real Prisma delegate, so argument and result shapes are checked by the
// compiler instead of being erased behind hand-written `any` signatures.
type PreferencePrisma = Pick<PrismaClient, "notificationPreference">;

function caller(req: AuthRequest, res: Response): string | null {
  const walletAddress = req.user?.walletAddress?.trim();
  if (!walletAddress) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return walletAddress;
}

function normalizePreferences(value: unknown): Preferences {
  const parsed = preferencesSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function createNotificationPreferencesRouter(
  prisma: PreferencePrisma = defaultPrisma,
) {
  const router = Router();

  router.get("/notifications/preferences", authMiddleware, async (req: AuthRequest, res, next) => {
    try {
      const walletAddress = caller(req, res);
      if (!walletAddress) return;

      const record = await prisma.notificationPreference.findUnique({
        where: { userAddress: walletAddress },
      });

      res.status(200).json({ preferences: normalizePreferences(record?.preferences) });
    } catch (error) {
      next(error);
    }
  });

  router.put(
    "/notifications/preferences",
    authMiddleware,
    validateRequest({ body: preferencesSchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const walletAddress = caller(req, res);
        if (!walletAddress) return;

        const incoming = req.body as Preferences;
        const existing = await prisma.notificationPreference.findUnique({
          where: { userAddress: walletAddress },
        });
        const merged = {
          ...normalizePreferences(existing?.preferences),
          ...incoming,
        };

        const saved = await prisma.notificationPreference.upsert({
          where: { userAddress: walletAddress },
          create: { userAddress: walletAddress, preferences: merged },
          update: { preferences: merged },
        });

        res.status(200).json({ preferences: normalizePreferences(saved.preferences ?? merged) });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export const notificationPreferencesRoutes = createNotificationPreferencesRouter();

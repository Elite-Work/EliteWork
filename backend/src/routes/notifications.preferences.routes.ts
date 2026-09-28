import { PrismaClient } from "@prisma/client";
import { Response, Router } from "express";
import { z } from "zod";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";

const notificationChannelSchema = z.enum(["email", "push", "in-app", "sms"]);
const preferencesSchema = z.record(
  z.string().min(1),
  z.array(notificationChannelSchema).max(4),
);

type Preferences = Record<string, Array<"email" | "push" | "in-app" | "sms">>;

/**
 * E.164-ish phone number, e.g. "+2348012345678". Deliberately permissive
 * (no per-country validation) — the SMS provider (Africa's Talking)
 * validates the number itself and returns a clear per-recipient error we
 * surface instead of duplicating that logic here.
 */
const phoneNumberSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "phoneNumber must be in E.164 format, e.g. +2348012345678");

const smsSettingsBodySchema = z.object({
  phoneNumber: phoneNumberSchema,
});

type PreferencePrisma = PrismaClient & {
  notificationPreference?: {
    findUnique: (args: any) => Promise<{ preferences: unknown; phoneNumber?: string | null } | null>;
    upsert: (args: any) => Promise<{ preferences: unknown; phoneNumber?: string | null }>;
  };
};

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
  prisma: PreferencePrisma = defaultPrisma as PreferencePrisma,
) {
  const router = Router();

  router.get("/notifications/preferences", authMiddleware, async (req: AuthRequest, res, next) => {
    try {
      const walletAddress = caller(req, res);
      if (!walletAddress) return;

      const record = await prisma.notificationPreference?.findUnique({
        where: { userAddress: walletAddress },
      });

      res.status(200).json({
        preferences: normalizePreferences(record?.preferences),
        phoneNumber: record?.phoneNumber ?? null,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * SMS is opt-in per event via `preferences`, but the phone number it goes
   * to is set separately (never inferred, e.g. from a wallet or profile
   * field) so a user always explicitly confirms the number that will
   * receive trade-status texts.
   */
  router.put(
    "/notifications/sms-settings",
    authMiddleware,
    validateRequest({ body: smsSettingsBodySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const walletAddress = caller(req, res);
        if (!walletAddress) return;

        const { phoneNumber } = req.body as z.infer<typeof smsSettingsBodySchema>;
        const existing = await prisma.notificationPreference?.findUnique({
          where: { userAddress: walletAddress },
        });

        const saved = await prisma.notificationPreference?.upsert({
          where: { userAddress: walletAddress },
          create: { userAddress: walletAddress, preferences: {}, phoneNumber },
          update: { phoneNumber },
        });

        res.status(200).json({
          preferences: normalizePreferences(existing?.preferences ?? {}),
          phoneNumber: saved?.phoneNumber ?? phoneNumber,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    "/notifications/preferences",
    authMiddleware,
    validateRequest({ body: preferencesSchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const walletAddress = caller(req, res);
        if (!walletAddress) return;

        const incoming = req.body as Preferences;
        const existing = await prisma.notificationPreference?.findUnique({
          where: { userAddress: walletAddress },
        });
        const merged = {
          ...normalizePreferences(existing?.preferences),
          ...incoming,
        };

        const saved = await prisma.notificationPreference?.upsert({
          where: { userAddress: walletAddress },
          create: { userAddress: walletAddress, preferences: merged },
          update: { preferences: merged },
        });

        res.status(200).json({ preferences: normalizePreferences(saved?.preferences ?? merged) });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export const notificationPreferencesRoutes = createNotificationPreferencesRouter();

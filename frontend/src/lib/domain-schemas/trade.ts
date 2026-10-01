/**
 * CANONICAL trade domain schema — shared between backend request validation and
 * frontend form validation so the two cannot drift.
 *
 * This file is framework-free (only `zod`) and is kept byte-identical with
 * `backend/src/schemas/domain/trade.ts`. `scripts/check-schema-parity.mjs`
 * fails CI if they diverge. The documented next rollout step is to promote this
 * to a `packages/domain-schemas` workspace package (see docs/shared-schemas.md).
 */
import { z } from "zod";

export const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z2-7]{55}$/;
export const USDC_AMOUNT_REGEX = /^\d+(\.\d{1,7})?$/;
export const LOSS_BPS_MIN = 0;
export const LOSS_BPS_MAX = 10_000;
export const LOSS_BPS_SUM = 10_000;
export const DEFAULT_LOSS_BPS = 5_000;

export const stellarPublicKey = z
  .string()
  .regex(STELLAR_PUBLIC_KEY_REGEX, "Invalid Stellar public key");

export const lossBps = z
  .number()
  .int("Must be a whole number")
  .min(LOSS_BPS_MIN, `Cannot be below ${LOSS_BPS_MIN}`)
  .max(LOSS_BPS_MAX, `Cannot exceed ${LOSS_BPS_MAX}`);

export const usdcAmount = z.string().regex(USDC_AMOUNT_REGEX, "Invalid amount format");

export const createTradeInputSchema = z
  .object({
    buyerAddress: stellarPublicKey.optional(),
    sellerAddress: stellarPublicKey,
    amountUsdc: usdcAmount,
    buyerLossBps: lossBps.optional(),
    sellerLossBps: lossBps.optional(),
    description: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const buyer = data.buyerLossBps ?? DEFAULT_LOSS_BPS;
    const seller = data.sellerLossBps ?? DEFAULT_LOSS_BPS;
    if (buyer + seller !== LOSS_BPS_SUM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `buyerLossBps and sellerLossBps must sum to ${LOSS_BPS_SUM}`,
        path: ["buyerLossBps"],
      });
    }
  });

export type CreateTradeInput = z.infer<typeof createTradeInputSchema>;

/** Flatten a ZodError into `{ field: message }` for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { moneyString } from "./money.schemas";

const stellarPublicKey = z.string().refine(StrKey.isValidEd25519PublicKey, {
  message: "Invalid Stellar public key for sellerAddress",
});

// String only: a JSON number silently loses precision above 2^53 stroops.
const amountUsdc = moneyString();

export const createTradeTemplateSchema = z
  .object({
    name: z.string().trim().min(1, "Template name is required").max(100),
    sellerAddress: stellarPublicKey,
    amountUsdc,
    buyerLossBps: z.number().int().min(0).max(10000).default(5000),
    sellerLossBps: z.number().int().min(0).max(10000).default(5000),
  })
  .superRefine((value: { buyerLossBps: number; sellerLossBps: number }, ctx: z.RefinementCtx) => {
    if (value.buyerLossBps + value.sellerLossBps !== 10000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["buyerLossBps"],
        message: "sum of buyerLossBps and sellerLossBps must equal 10000",
      });
    }
  });

export const templateIdParamSchema = z.object({
  templateId: z.coerce.number().int().positive(),
});

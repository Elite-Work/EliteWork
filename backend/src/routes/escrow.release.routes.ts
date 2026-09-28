import { Prisma, PrismaClient, TradeStatus } from "@prisma/client";
import { Response, Router } from "express";
import { z } from "zod";
import { prisma as defaultPrisma } from "../lib/db";
import { getMediatorAllowlist } from "../lib/accessControl";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";
import { ContractService } from "../services/contract.service";
import {
  DuplicatePayoutError,
  PayoutIntentService,
  payoutIntentService as defaultPayoutIntentService,
} from "../services/payoutIntent.service";

const releaseParamsSchema = z.object({
  id: z.string().min(1),
});

const milestoneBodySchema = z.object({
  milestoneIndex: z.coerce.number().int().min(0),
});

type ReleasePrisma = PrismaClient & {
  escrowReleaseMilestone?: {
    findMany: (args: Prisma.EscrowReleaseMilestoneFindManyArgs) => Promise<Array<{
      milestoneIndex: number;
      amountUsdc: string;
      dueAt: Date;
      releasedAt: Date | null;
    }>>;
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

function canRelease(trade: { buyerAddress: string }, walletAddress: string): boolean {
  const callerAddress = walletAddress.toLowerCase();
  return (
    trade.buyerAddress.toLowerCase() === callerAddress ||
    getMediatorAllowlist().has(callerAddress)
  );
}

/**
 * Reads the caller's `Idempotency-Key` header. Absent, the service derives a
 * deterministic key from the payout itself, so a retry that omits the header is
 * still recognised as the same payout.
 */
function idempotencyKeyFrom(req: AuthRequest): string | undefined {
  const raw = req.headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function tradeWhere(id: string) {
  const numericId = Number(id);
  const orConditions: Array<Record<string, unknown>> = [{ tradeId: id }];
  if (Number.isInteger(numericId) && numericId > 0) {
    orConditions.push({ id: numericId });
  }
  return { OR: orConditions };
}

export function createEscrowReleaseRouter(
  prisma: ReleasePrisma = defaultPrisma as ReleasePrisma,
  contractService: Pick<ContractService, "buildReleaseMilestoneTx"> = new ContractService(),
  payoutIntents: Pick<PayoutIntentService, "claim"> = defaultPayoutIntentService,
) {
  const router = Router();

  router.post(
    "/:id/release/milestone",
    authMiddleware,
    validateRequest({ params: releaseParamsSchema, body: milestoneBodySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const walletAddress = caller(req, res);
        if (!walletAddress) return;

        const id = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
        const { milestoneIndex } = req.body as z.infer<typeof milestoneBodySchema>;
        const trade = await prisma.trade.findFirst({ where: tradeWhere(id) });

        if (!trade) {
          res.status(404).json({ error: "Trade not found" });
          return;
        }

        if (trade.status !== TradeStatus.FUNDED && trade.status !== TradeStatus.DELIVERED) {
          res.status(400).json({
            error: `Trade must be FUNDED or DELIVERED for milestone release (current: ${trade.status})`,
          });
          return;
        }

        if (!canRelease(trade, walletAddress)) {
          res.status(403).json({ error: "Only the buyer or an admin may release a milestone" });
          return;
        }

        if (!prisma.escrowReleaseMilestone) {
          res.status(404).json({ error: "Release schedule not found" });
          return;
        }

        const schedule = await prisma.escrowReleaseMilestone.findMany({
          where: { tradeId: trade.tradeId },
          orderBy: { milestoneIndex: "asc" },
        });

        if (schedule.length === 0) {
          res.status(404).json({ error: "Release schedule not found" });
          return;
        }

        if (schedule.every((milestone: { releasedAt: Date | null }) => milestone.releasedAt)) {
          res.status(409).json({ error: "Release schedule is already completed" });
          return;
        }

        const milestone = schedule.find(
          (item: { milestoneIndex: number }) => item.milestoneIndex === milestoneIndex,
        );
        if (!milestone) {
          res.status(400).json({ error: "Milestone index is outside the release schedule" });
          return;
        }

        if (milestone.releasedAt) {
          res.status(409).json({ error: "Milestone has already been released" });
          return;
        }

        if (milestone.dueAt.getTime() > Date.now()) {
          res.status(400).json({ error: "Milestone is not due yet" });
          return;
        }

        // Claim the payout before building anything. `milestone.releasedAt`
        // above is only set once the on-chain event is confirmed, so it does
        // not cover the window between a successful submission and that write —
        // which is exactly where a retry used to produce a second payout.
        let intentKey: string;
        try {
          const { intent, duplicate } = await payoutIntents.claim({
            idempotencyKey: idempotencyKeyFrom(req),
            kind: "MILESTONE_RELEASE",
            tradeId: trade.tradeId,
            milestoneIndex,
            amountUsdc: milestone.amountUsdc,
            destination: trade.sellerAddress,
            requestedBy: walletAddress,
          });
          intentKey = intent.idempotencyKey;

          if (duplicate) {
            // An earlier attempt is unresolved. Reconciliation decides its
            // outcome; re-issuing a transaction here could double-pay.
            res.status(409).json({
              error: "A release for this milestone is already in progress",
              idempotencyKey: intent.idempotencyKey,
              status: intent.status,
              txHash: intent.txHash,
            });
            return;
          }
        } catch (error) {
          if (error instanceof DuplicatePayoutError) {
            res.status(409).json({
              error: "This milestone has already been released",
              idempotencyKey: error.intent.idempotencyKey,
              txHash: error.intent.txHash,
            });
            return;
          }
          throw error;
        }

        const { unsignedXdr } = await contractService.buildReleaseMilestoneTx({
          tradeId: trade.tradeId,
          sourceAddress: walletAddress,
          milestoneIndex,
        });

        // The key goes back to the caller so the signed submission can be tied
        // to this intent, and so a retry can reuse it verbatim.
        res.status(200).json({ unsignedXdr, idempotencyKey: intentKey });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export const escrowReleaseRoutes = createEscrowReleaseRouter();

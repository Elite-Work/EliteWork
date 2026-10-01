import { PrismaClient } from "@prisma/client";
import { Response, Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware } from "../middleware/admin.middleware";
import { adminTimeoutMiddleware } from "../middleware/adminTimeout.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";
import { traceContextFrom } from "../middleware/correlationId.middleware";
import { ContractService } from "../services/contract.service";
import { createWalletRateLimiter } from "../lib/rateLimit";
import { RATE_LIMIT_CONFIG } from "../config/rateLimit";
import { classifyAdminSubmissionError } from "../errors/adminSubmissionError";
import { prisma as defaultPrisma } from "../lib/db";
import * as StellarSdk from "@stellar/stellar-sdk";

const stellarAddress = z
  .string()
  .refine((value) => StellarSdk.StrKey.isValidEd25519PublicKey(value), {
    message: "Must be a valid Stellar public key",
  });

const addMediatorBodySchema = z.object({
  mediatorAddress: stellarAddress,
});

const mediatorAddressParamSchema = z.object({
  address: stellarAddress,
});

const updateFeeBodySchema = z.object({
  feeBps: z.number().int().min(1).max(500),
});

const adminRateLimit = createWalletRateLimiter(RATE_LIMIT_CONFIG.admin);

export function createAdminContractRouter(
  contractService: ContractService = new ContractService(),
  prisma: PrismaClient = defaultPrisma,
  timeoutMs?: number,
) {
  const router = Router();
  const timeoutMiddleware = adminTimeoutMiddleware(timeoutMs);

  router.post(
    "/api/admin/contract/mediators",
    authMiddleware,
    adminMiddleware,
    adminRateLimit,
    timeoutMiddleware,
    validateRequest({ body: addMediatorBodySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const { mediatorAddress } = req.body as { mediatorAddress: string };
        const adminAddress = req.user!.walletAddress;
        const result = await contractService.buildAddMediatorTx({
          adminAddress,
          mediatorAddress,
          trace: traceContextFrom(req),
        });
        if (res.headersSent) return;
        await prisma?.adminActionAudit.create({
          data: { action: "ADD_MEDIATOR", actorAddress: adminAddress, targetReference: mediatorAddress },
        });
        if (res.headersSent) return;
        res.status(200).json(result);
      } catch (error) {
        next(classifyAdminSubmissionError(error, "add_mediator"));
      }
    },
  );

  router.delete(
    "/api/admin/contract/mediators/:address",
    authMiddleware,
    adminMiddleware,
    adminRateLimit,
    timeoutMiddleware,
    validateRequest({ params: mediatorAddressParamSchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const { address: mediatorAddress } = req.params as { address: string };
        const adminAddress = req.user!.walletAddress;
        const result = await contractService.buildRemoveMediatorTx({
          adminAddress,
          mediatorAddress,
          trace: traceContextFrom(req),
        });
        if (res.headersSent) return;
        await prisma?.adminActionAudit.create({
          data: { action: "REMOVE_MEDIATOR", actorAddress: adminAddress, targetReference: mediatorAddress },
        });
        if (res.headersSent) return;
        res.status(200).json(result);
      } catch (error) {
        next(classifyAdminSubmissionError(error, "remove_mediator"));
      }
    },
  );

  router.patch(
    "/api/admin/contract/fee",
    authMiddleware,
    adminMiddleware,
    adminRateLimit,
    timeoutMiddleware,
    validateRequest({ body: updateFeeBodySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const { feeBps } = req.body as { feeBps: number };
        const adminAddress = req.user!.walletAddress;
        const result = await contractService.buildUpdateFeeBpsTx({
          adminAddress,
          feeBps,
          trace: traceContextFrom(req),
        });
        if (res.headersSent) return;
        await prisma?.adminActionAudit.create({
          data: { action: "UPDATE_FEE_BPS", actorAddress: adminAddress, targetReference: String(feeBps) },
        });
        if (res.headersSent) return;
        res.status(200).json(result);
      } catch (error) {
        next(classifyAdminSubmissionError(error, "update_fee_bps"));
      }
    },
  );

  return router;
}

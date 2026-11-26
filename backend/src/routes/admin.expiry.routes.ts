import { Response, Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { adminMiddleware } from '../middleware/admin.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { AuthRequest } from '../services/auth.service';
import { tradeExpiryService } from '../services/tradeExpiry.service';
import { tradeExpiryQueue } from '../jobs/queue';
import { appLogger } from '../middleware/logger';

const sweepBodySchema = z.object({
  batchSize: z.number().int().min(1).max(500).default(100),
});

/**
 * OpenAPI documentation metadata for the admin expiry route group.
 * Consumed by the OpenAPI coverage test to verify every exported endpoint
 * is documented in backend/src/docs/openapi.yaml.
 */
export const adminExpiryRouteDocs = [
  {
    method: 'post',
    path: '/api/admin/trades/sweep-expired',
    requestBody: sweepBodySchema,
    responseSchema: z.object({
      swept: z.number().int(),
      refunded: z.number().int(),
    }),
  },
  {
    method: 'post',
    path: '/api/admin/trades/sweep-expired/enqueue',
    requestBody: sweepBodySchema,
    responseSchema: z.object({
      jobId: z.union([z.string(), z.number()]).nullable(),
      batchSize: z.number().int(),
    }),
  },
  {
    method: 'get',
    path: '/api/admin/trades/pending-refunds',
    responseSchema: z.object({
      count: z.number().int(),
      trades: z.array(z.unknown()),
    }),
  },
] as const;

export function createAdminExpiryRouter(): Router {
  const router = Router();

  router.use(authMiddleware, adminMiddleware);

  /**
   * POST /api/admin/trades/sweep-expired
   * Trigger an immediate expiry sweep (admin override for stuck expiries).
   */
  router.post(
    '/api/admin/trades/sweep-expired',
    validateRequest({ body: sweepBodySchema }),
    async (req: AuthRequest, res: Response) => {
      try {
        const { batchSize } = sweepBodySchema.parse(req.body);
        const result = await tradeExpiryService.sweepExpiredTrades(batchSize);
        appLogger.info({ actorAddress: req.user?.walletAddress, ...result }, 'Admin triggered expiry sweep');
        res.json(result);
      } catch (err) {
        appLogger.error({ err }, 'Admin expiry sweep failed');
        res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /api/admin/trades/sweep-expired/enqueue
   * Enqueue an expiry sweep job to run asynchronously.
   */
  router.post(
    '/api/admin/trades/sweep-expired/enqueue',
    validateRequest({ body: sweepBodySchema }),
    async (req: AuthRequest, res: Response) => {
      try {
        const { batchSize } = sweepBodySchema.parse(req.body);
        const job = await tradeExpiryQueue.add('admin-sweep', { batchSize });
        res.json({ jobId: job.id, batchSize });
      } catch (err) {
        appLogger.error({ err }, 'Failed to enqueue expiry sweep');
        res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /api/admin/trades/pending-refunds
   * Lists EXPIRED trades awaiting on-chain refund submission.
   */
  router.get(
    '/api/admin/trades/pending-refunds',
    async (_req: AuthRequest, res: Response) => {
      try {
        const pending = await tradeExpiryService.getPendingRefunds();
        res.json({ count: pending.length, trades: pending });
      } catch (err) {
        appLogger.error({ err }, 'Failed to fetch pending refunds');
        res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  return router;
}

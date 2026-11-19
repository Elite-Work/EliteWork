import crypto from 'crypto';
import { Response, Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { adminMiddleware } from '../middleware/admin.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { AuthRequest } from '../services/auth.service';
import { appLogger } from '../middleware/logger';
import { createWalletRateLimiter } from '../lib/rateLimit';
import { RATE_LIMIT_CONFIG } from '../config/rateLimit';
import { getDeadLetterQueue, type DeadLetterEntry } from '../jobs/deadLetter';
import {
  webhookQueue,
  notificationQueue,
  exportQueue,
  tradeExpiryQueue,
  reconciliationQueue,
} from '../jobs/queue';
import type { Queue } from 'bullmq';

const QUEUE_REGISTRY: Record<string, Queue> = {
  webhooks: webhookQueue,
  notifications: notificationQueue,
  exports: exportQueue,
  'trade-expiry': tradeExpiryQueue,
  reconciliation: reconciliationQueue,
};

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const listSummaryQuerySchema = listQuerySchema.extend({
  queue: z.string().trim().min(1).default('webhooks'),
});

export interface DlqEventSummary {
  eventId: string;
  queue: string;
  jobName: string;
  payloadHash: string;
  failureReason: string;
  errorClass: string;
  retryCount: number;
  failedAt: string;
}

export function hashDlqPayload(payload: unknown): string {
  const serialized = JSON.stringify(payload ?? null);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

function toDlqEventSummary(
  jobId: string | undefined,
  queueName: string,
  entry: DeadLetterEntry,
): DlqEventSummary {
  return {
    eventId: String(jobId ?? ''),
    queue: entry.originalQueue || queueName,
    jobName: entry.jobName,
    payloadHash: hashDlqPayload(entry.data),
    failureReason: entry.errorMessage,
    errorClass: entry.errorClass,
    retryCount: entry.attemptsMade,
    failedAt: entry.failedAt,
  };
}

export function createAdminDlqRouter(): Router {
  const router = Router();
  const adminRateLimit = createWalletRateLimiter(RATE_LIMIT_CONFIG.admin);

  router.use(authMiddleware, adminMiddleware, adminRateLimit);

  /** GET /api/admin/dlq — list failed event summaries with error details (defaults to webhooks) */
  router.get(
    '/api/admin/dlq',
    validateRequest({ query: listSummaryQuerySchema }),
    async (req: AuthRequest, res: Response) => {
      const { queue: queueName, page, limit } = listSummaryQuerySchema.parse(req.query);
      if (!QUEUE_REGISTRY[queueName]) {
        return res.status(404).json({ error: 'Unknown queue' });
      }
      try {
        const dlq = getDeadLetterQueue(queueName);
        const start = (page - 1) * limit;
        const jobs = await dlq.getJobs(['waiting', 'delayed', 'active'], start, start + limit - 1);
        const depth = await dlq.count();
        res.json({
          queue: queueName,
          depth,
          page,
          limit,
          events: jobs.map((job) => toDlqEventSummary(job.id, queueName, job.data)),
        });
      } catch (err) {
        appLogger.error({ err, queueName }, 'Failed to list dead-letter event summaries');
        res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  /** GET /api/admin/dlq/:queue — list dead-lettered jobs for a queue family */
  router.get(
    '/api/admin/dlq/:queue',
    validateRequest({ query: listQuerySchema }),
    async (req: AuthRequest, res: Response) => {
      const { queue: queueName } = req.params as { queue: string };
      if (!QUEUE_REGISTRY[queueName]) {
        return res.status(404).json({ error: 'Unknown queue' });
      }
      try {
        const { page, limit } = listQuerySchema.parse(req.query);
        const dlq = getDeadLetterQueue(queueName);
        const start = (page - 1) * limit;
        const jobs = await dlq.getJobs(['waiting', 'delayed', 'active'], start, start + limit - 1);
        const depth = await dlq.count();
        res.json({
          queue: queueName,
          depth,
          jobs: jobs.map((job) => ({ id: job.id, ...job.data })),
        });
      } catch (err) {
        appLogger.error({ err, queueName }, 'Failed to list dead-letter jobs');
        res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  /** GET /api/admin/dlq/:queue/depth — current dead-letter depth, for alerting/dashboards */
  router.get('/api/admin/dlq/:queue/depth', async (req: AuthRequest, res: Response) => {
    const { queue: queueName } = req.params as { queue: string };
    if (!QUEUE_REGISTRY[queueName]) {
      return res.status(404).json({ error: 'Unknown queue' });
    }
    try {
      const depth = await getDeadLetterQueue(queueName).count();
      res.json({ queue: queueName, depth });
    } catch (err) {
      appLogger.error({ err, queueName }, 'Failed to read dead-letter depth');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/admin/dlq/:queue/:jobId/replay — re-enqueue a dead-lettered job on its source queue */
  router.post('/api/admin/dlq/:queue/:jobId/replay', async (req: AuthRequest, res: Response) => {
    const { queue: queueName, jobId } = req.params as { queue: string; jobId: string };
    const targetQueue = QUEUE_REGISTRY[queueName];
    if (!targetQueue) {
      return res.status(404).json({ error: 'Unknown queue' });
    }
    try {
      const dlq = getDeadLetterQueue(queueName);
      const dlqJob = await dlq.getJob(jobId);
      // Removing the DLQ entry before returning makes replay idempotent:
      // a repeated call finds no job and 404s instead of double-enqueuing.
      if (!dlqJob) {
        return res
          .status(404)
          .json({ error: 'Dead-letter job not found (already replayed or does not exist)' });
      }
      await targetQueue.add(dlqJob.data.jobName, dlqJob.data.data);
      await dlqJob.remove();

      appLogger.info(
        { queueName, jobId, adminAddress: req.user?.walletAddress },
        'Dead-letter job replayed',
      );
      res.json({ success: true, queue: queueName, replayedJobId: jobId });
    } catch (err) {
      appLogger.error({ err, queueName, jobId }, 'Failed to replay dead-letter job');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

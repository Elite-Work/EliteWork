import { Response, Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { adminMiddleware } from '../middleware/admin.middleware';
import { validateRequest } from '../middleware/validateRequest';
import { AuthRequest } from '../services/auth.service';
import { appLogger } from '../middleware/logger';
import { getDeadLetterQueue } from '../jobs/deadLetter';
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

/**
 * OpenAPI coverage metadata for the admin DLQ route group.
 *
 * Each entry mirrors a route registered below so that coverage tests can
 * assert every exported endpoint is documented in `backend/src/docs/openapi.yaml`
 * (drift tests only catch documented paths, not undocumented ones).
 */
export const adminDlqRouteDocs = [
  {
    method: 'get',
    path: '/api/admin/dlq/{queue}',
    operationId: 'listAdminDlqJobs',
    summary: 'List dead-lettered jobs for a queue family',
    tags: ['Admin'],
    parameters: [
      { name: 'queue', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1, default: 1 } },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
    ],
    responses: {
      '200': {
        description: 'Dead-letter jobs for the queue',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['queue', 'depth', 'jobs'],
              properties: {
                queue: { type: 'string' },
                depth: { type: 'integer' },
                jobs: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { id: { type: 'string' } },
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
      },
      '404': { description: 'Unknown queue' },
      '500': { description: 'Internal server error' },
    },
  },
  {
    method: 'get',
    path: '/api/admin/dlq/{queue}/depth',
    operationId: 'getAdminDlqDepth',
    summary: 'Current dead-letter depth, for alerting/dashboards',
    tags: ['Admin'],
    parameters: [{ name: 'queue', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '200': {
        description: 'Dead-letter depth for the queue',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['queue', 'depth'],
              properties: {
                queue: { type: 'string' },
                depth: { type: 'integer' },
              },
            },
          },
        },
      },
      '404': { description: 'Unknown queue' },
      '500': { description: 'Internal server error' },
    },
  },
  {
    method: 'post',
    path: '/api/admin/dlq/{queue}/{jobId}/replay',
    operationId: 'replayAdminDlqJob',
    summary: 'Re-enqueue a dead-lettered job on its source queue',
    tags: ['Admin'],
    parameters: [
      { name: 'queue', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'jobId', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: {
      '200': {
        description: 'Job replayed',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['success', 'queue', 'replayedJobId'],
              properties: {
                success: { type: 'boolean' },
                queue: { type: 'string' },
                replayedJobId: { type: 'string' },
              },
            },
          },
        },
      },
      '404': { description: 'Unknown queue or dead-letter job not found' },
      '500': { description: 'Internal server error' },
    },
  },
] as const;

export function createAdminDlqRouter(): Router {
  const router = Router();

  router.use(authMiddleware, adminMiddleware);

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

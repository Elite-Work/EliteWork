import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { appLogger } from '../middleware/logger';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const queueConnections: IORedis[] = [];

/**
 * Queue resilience: BullMQ connections auto-reconnect with exponential backoff.
 * Consumers resume cleanly after reconnect — jobs are durable in Redis and
 * workers re-attach. See docs/redis-resilience.md#queue-consumers
 */
export function createQueueConnection(): IORedis {
  const conn: IORedis = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // Reconnect strategy: exponential backoff up to 5s, 20 retries then error
    retryStrategy(times: number) {
      if (times > 20) {
        appLogger.error({ times }, "Queue Redis retry exhausted — giving up");
        return null;
      }
      const delay = Math.min(times * 200, 5000);
      appLogger.warn({ times, delay }, "Queue Redis reconnecting");
      return delay;
    },
  } as any);

  (conn as any).on("error", (err: Error) => {
    appLogger.error({ err: err.message }, "Queue Redis connection error");
  });
  (conn as any).on("close", () => {
    appLogger.warn("Queue Redis connection closed — will reconnect");
  });
  (conn as any).on("reconnecting", () => {
    appLogger.info("Queue Redis reconnecting");
  });
  (conn as any).on("ready", () => {
    appLogger.info("Queue Redis ready — consumers will resume");
  });

  queueConnections.push(conn);
  return conn;
}

/**
 * Close all queue producer Redis connections.
 * Called during graceful shutdown after workers have been drained.
 */
export async function closeAllQueueConnections(): Promise<void> {
  const results = await Promise.allSettled(
    queueConnections.map((conn) => conn.quit()),
  );
  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    appLogger.warn(
      { count: failures.length },
      "Some queue Redis connections failed to close cleanly",
    );
  }
  queueConnections.length = 0;
}

export interface WebhookJobData {
  tradeId: string;
  event: string;
  status: string;
  payload: Record<string, unknown>;
}

export interface NotificationJobData {
  userAddress: string;
  type: 'in_app' | 'email' | 'push';
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ExportJobData {
  requestedBy: string;
  format: 'csv' | 'json';
  tradeIds?: string[];
  filters?: Record<string, unknown>;
}

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
};

export const webhookQueue = new Queue<WebhookJobData>('webhooks', {
  connection: createQueueConnection(),
  defaultJobOptions,
});

export const notificationQueue = new Queue<NotificationJobData>('notifications', {
  connection: createQueueConnection(),
  defaultJobOptions,
});

export const exportQueue = new Queue<ExportJobData>('exports', {
  connection: createQueueConnection(),
  defaultJobOptions,
});

export interface TradeExpirySweepJobData {
  batchSize?: number;
}

export const tradeExpiryQueue = new Queue<TradeExpirySweepJobData>('trade-expiry', {
  connection: createQueueConnection(),
  defaultJobOptions,
});

export interface PiiScanJobData {
  scanId?: string;
}

export const piiScanQueue = new Queue<PiiScanJobData>('pii-log-scan', {
  connection: createQueueConnection(),
  defaultJobOptions,
});

export interface ReconciliationSweepJobData {
  sweepId?: string;
}

export const reconciliationQueue = new Queue<ReconciliationSweepJobData>('reconciliation', {
  connection: createQueueConnection(),
  defaultJobOptions,
});

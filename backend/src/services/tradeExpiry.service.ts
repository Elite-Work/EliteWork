import { PrismaClient, TradeStatus } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/db';
import { appLogger } from '../middleware/logger';
import { notificationQueue, NotificationJobData } from '../jobs/queue';
import { recordTradeFunnelEvent } from '../lib/metrics';

/**
 * Enqueues the in-app notification job, plus an SMS fallback job when the
 * recipient has opted `eventKey` into the "sms" channel (see
 * notifications.preferences.routes.ts). Rural pilot regions with limited
 * data connectivity may never see the in-app toast/push promptly, so a
 * trade lifecycle change is also worth a text.
 */
async function enqueueTradeLifecycleNotification(
  db: PrismaClient,
  eventKey: string,
  job: Omit<NotificationJobData, 'type'>,
): Promise<void> {
  const tasks: Promise<unknown>[] = [
    notificationQueue.add(eventKey, { ...job, type: 'in_app' }),
  ];

  try {
    const pref = await (db as unknown as {
      notificationPreference?: {
        findUnique: (args: unknown) => Promise<{ preferences: unknown } | null>;
      };
    }).notificationPreference?.findUnique({ where: { userAddress: job.userAddress } });

    const channels = pref?.preferences as Record<string, string[]> | undefined;
    if (channels?.[eventKey]?.includes('sms')) {
      tasks.push(notificationQueue.add(`${eventKey}-sms`, { ...job, type: 'sms' }));
    }
  } catch (err) {
    // Never let an SMS-preference lookup failure block the in-app notification.
    appLogger.warn({ eventKey, userAddress: job.userAddress, err }, 'Failed to check SMS notification preference');
  }

  await Promise.all(tasks);
}

export interface SweepResult {
  scanned: number;
  expired: number;
  errors: number;
}

/** Non-terminal statuses eligible for expiry sweep. */
const EXPIRABLE_STATUSES: TradeStatus[] = [
  TradeStatus.CREATED,
  TradeStatus.FUNDED,
  TradeStatus.PENDING_SIGNATURE,
];

export class TradeExpiryService {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  /**
   * Scans for trades whose `expiresAt` has passed and whose status is still
   * non-terminal. Marks each as EXPIRED and enqueues buyer/seller notifications.
   * Idempotent: already-expired trades are skipped.
   */
  async sweepExpiredTrades(batchSize = 100): Promise<SweepResult> {
    const now = new Date();
    const result: SweepResult = { scanned: 0, expired: 0, errors: 0 };

    const stale = await this.db.trade.findMany({
      where: {
        expiresAt: { lte: now },
        status: { in: EXPIRABLE_STATUSES },
        expiredAt: null,
      },
      take: batchSize,
      select: {
        id: true,
        tradeId: true,
        buyerAddress: true,
        sellerAddress: true,
        amountUsdc: true,
        status: true,
        version: true,
      },
      orderBy: { expiresAt: 'asc' },
    });

    result.scanned = stale.length;

    for (const trade of stale) {
      try {
        await this.db.trade.updateMany({
          where: {
            id: trade.id,
            version: trade.version,
            status: { in: EXPIRABLE_STATUSES },
          },
          data: {
            status: TradeStatus.EXPIRED,
            expiredAt: now,
            version: { increment: 1 },
          },
        });

        await Promise.all([
          enqueueTradeLifecycleNotification(this.db, 'trade-expired', {
            userAddress: trade.buyerAddress,
            title: 'Trade Expired',
            message: `Trade ${trade.tradeId} has expired. A refund will be processed shortly.`,
            metadata: { tradeId: trade.tradeId, amountUsdc: trade.amountUsdc },
          }),
          enqueueTradeLifecycleNotification(this.db, 'trade-expired', {
            userAddress: trade.sellerAddress,
            title: 'Trade Expired',
            message: `Trade ${trade.tradeId} has expired and was not completed.`,
            metadata: { tradeId: trade.tradeId },
          }),
        ]);

        result.expired++;
        recordTradeFunnelEvent("expired");
        appLogger.info({ tradeId: trade.tradeId, previousStatus: trade.status }, 'Trade expired by sweeper');
      } catch (err) {
        result.errors++;
        appLogger.error({ tradeId: trade.tradeId, err }, 'Sweeper failed to expire trade');
      }
    }

    return result;
  }

  /** Returns trades that have been marked EXPIRED but not yet refunded on-chain. */
  async getPendingRefunds(limit = 50) {
    return this.db.trade.findMany({
      where: { status: TradeStatus.EXPIRED },
      take: limit,
      orderBy: { expiredAt: 'asc' },
      select: {
        tradeId: true,
        buyerAddress: true,
        amountUsdc: true,
        expiredAt: true,
      },
    });
  }
}

export const tradeExpiryService = new TradeExpiryService();

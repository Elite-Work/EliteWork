import { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { appLogger } from "../middleware/logger";

export class WatchTradeNotFoundError extends Error {
  status = 404;
  constructor() {
    super("Trade not found");
    this.name = "WatchTradeNotFoundError";
  }
}

export class WatchTradeAccessDeniedError extends Error {
  status = 403;
  constructor() {
    super("Forbidden");
    this.name = "WatchTradeAccessDeniedError";
  }
}

type WatchlistDatabase = Pick<PrismaClient, "trade" | "userWatchlist"> &
  Partial<Pick<PrismaClient, "inAppNotification" | "notificationPreference">>;

/** A watched-trade lifecycle change to fan out to subscribers (#497). */
export interface WatchedTradeNotification {
  /** Preference key, e.g. `trade-funded` (see notifications.preferences routes). */
  eventKey: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  /** On-chain event id; used to de-duplicate queued push jobs on retries. */
  eventId?: string;
}

export interface WatchlistDispatchResult {
  /** Watchers that received an in-app notification row. */
  notified: number;
  /** Watchers whose preferences opted into push and had a job queued. */
  pushQueued: number;
}

export class TradeWatchlistService {
  constructor(private readonly prisma: WatchlistDatabase = defaultPrisma) {}

  private async assertTradeAccess(tradeId: string, userAddress: string) {
    const trade = await this.prisma.trade.findUnique({ where: { tradeId } });
    if (!trade) throw new WatchTradeNotFoundError();
    const caller = userAddress.toLowerCase();
    if (trade.buyerAddress.toLowerCase() !== caller && trade.sellerAddress.toLowerCase() !== caller) {
      throw new WatchTradeAccessDeniedError();
    }
    return trade;
  }

  async add(tradeId: string, userAddress: string) {
    const trade = await this.assertTradeAccess(tradeId, userAddress);
    const userAddressNormalized = userAddress.toLowerCase();
    const item = await this.prisma.userWatchlist.upsert({
      where: { userAddress_tradeId: { userAddress: userAddressNormalized, tradeId: trade.tradeId } },
      create: { userAddress: userAddressNormalized, tradeId: trade.tradeId },
      update: {},
    });
    return item;
  }

  async remove(tradeId: string, userAddress: string) {
    // Verify ownership even when no bookmark exists, avoiding a delete endpoint
    // that can be used to probe unrelated trades.
    const trade = await this.assertTradeAccess(tradeId, userAddress);
    const result = await this.prisma.userWatchlist.deleteMany({
      where: { userAddress: userAddress.toLowerCase(), tradeId: trade.tradeId },
    });
    return { removed: result.count > 0 };
  }

  async list(userAddress: string) {
    const entries = await this.prisma.userWatchlist.findMany({
      where: { userAddress: userAddress.toLowerCase() },
      include: { trade: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return entries.map(({ trade, createdAt }) => ({ ...trade, watchedAt: createdAt }));
  }

  /**
   * Fans a watched trade's status change out to everyone watching it (#497).
   *
   * In-app rows are written synchronously so they are visible as soon as the
   * chain-sync transaction that produced the event commits. Push is opt-in per
   * event via `NotificationPreference.preferences[eventKey]`; the queue job is
   * de-duplicated by the originating event id so an event-handler retry cannot
   * double-notify a device.
   *
   * Notification failures are logged and swallowed: a watcher's push provider
   * being down must never roll back the escrow state transition itself.
   */
  async dispatchTradeNotification(
    tradeId: string,
    update: WatchedTradeNotification,
  ): Promise<WatchlistDispatchResult> {
    const result: WatchlistDispatchResult = { notified: 0, pushQueued: 0 };
    const inApp = this.prisma.inAppNotification;
    if (!inApp || typeof inApp.create !== "function") return result;

    const watchers = await this.prisma.userWatchlist.findMany({
      where: { tradeId },
      select: { userAddress: true },
    });

    for (const { userAddress } of watchers) {
      try {
        await inApp.create({
          data: {
            userAddress,
            title: update.title,
            message: update.message,
            type: "trade",
            metadata: {
              tradeId,
              ...(update.eventId ? { eventId: update.eventId } : {}),
              ...update.metadata,
              eventKey: update.eventKey,
            } as Prisma.InputJsonValue,
          },
        });
        result.notified++;
      } catch (error) {
        appLogger.warn({ error, tradeId, userAddress }, "Watchlist in-app notification failed");
        continue;
      }

      const channels = await this.preferencesFor(userAddress);
      if (channels?.[update.eventKey]?.includes("push")) {
        try {
          // Loaded lazily so importing the read/write watchlist service (which
          // the API router does) does not open a Redis connection at startup.
          const { notificationQueue } = await import("../jobs/queue");
          await notificationQueue.add(
            `${update.eventKey}-push`,
            {
              userAddress,
              type: "push",
              title: update.title,
              message: update.message,
              metadata: { tradeId, ...update.metadata, eventKey: update.eventKey },
            },
            update.eventId ? { jobId: `${update.eventId}:${userAddress}:push` } : undefined,
          );
          result.pushQueued++;
        } catch (error) {
          appLogger.warn({ error, tradeId, userAddress }, "Watchlist push notification enqueue failed");
        }
      }
    }

    return result;
  }

  private async preferencesFor(
    userAddress: string,
  ): Promise<Record<string, string[]> | null> {
    const prefs = this.prisma.notificationPreference;
    if (!prefs || typeof prefs.findUnique !== "function") return null;
    try {
      const record = await prefs.findUnique({ where: { userAddress } });
      const value = record?.preferences;
      return value && typeof value === "object"
        ? (value as Record<string, string[]>)
        : null;
    } catch (error) {
      appLogger.warn({ error, userAddress }, "Watchlist notification preference lookup failed");
      return null;
    }
  }
}

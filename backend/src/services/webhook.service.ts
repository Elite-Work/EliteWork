import crypto from "crypto";
import { env } from "../config/env";
import { appLogger } from "../middleware/logger";
import { prisma } from "../lib/db";
import { TradeStatus } from "@prisma/client";

interface WebhookPayload {
  event: string;
  tradeId: string;
  status: TradeStatus;
  timestamp: string;
  data: Record<string, unknown>;
}

interface DeliveryTarget {
  url: string;
  secret?: string;
  subscriptionId?: number | null;
}

export interface WebhookServiceOptions {
  webhookUrl?: string;
  webhookSecret?: string;
  maxAttempts?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Computes exponential backoff with equal jitter:
 *   capped = min(baseMs * 2^(attempt - 1), maxMs)
 *   delay  = round(capped / 2 + random() * (capped / 2))
 *
 * Keeps delays strictly positive and bounded by [capped / 2, capped] while
 * spreading concurrent retries to avoid thundering-herd bursts against a
 * recovering subscriber.
 */
export function computeWebhookBackoffMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const capped = Math.min(baseMs * 2 ** Math.max(0, attempt - 1), maxMs);
  const half = capped / 2;
  const clampedRandom = Math.min(1, Math.max(0, random()));
  return Math.round(half + clampedRandom * half);
}

export class WebhookService {
  private readonly webhookUrl: string | undefined;
  private readonly webhookSecret: string | undefined;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: WebhookServiceOptions = {}) {
    this.webhookUrl = options.webhookUrl !== undefined ? options.webhookUrl : env.WEBHOOK_URL;
    this.webhookSecret =
      options.webhookSecret !== undefined ? options.webhookSecret : env.WEBHOOK_SECRET;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? env.WEBHOOK_MAX_ATTEMPTS);
    this.retryBaseMs = options.retryBaseMs ?? env.WEBHOOK_RETRY_BASE_MS;
    this.retryMaxMs = options.retryMaxMs ?? env.WEBHOOK_RETRY_MAX_MS;
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async dispatch(tradeId: string, status: TradeStatus, metadata: Record<string, unknown> = {}): Promise<void> {
    const event = `trade.${status.toLowerCase()}`;
    const activeSubscriptions = await prisma.webhookSubscription.findMany({
      where: {
        isActive: true,
        events: { has: event },
      },
      select: {
        id: true,
        url: true,
        secretHash: true,
      },
    });

    const deliveryTargets: DeliveryTarget[] = activeSubscriptions.map((subscription) => ({
      url: subscription.url,
      secret: subscription.secretHash,
      subscriptionId: subscription.id,
    }));

    if (this.webhookUrl) {
      deliveryTargets.push({
        url: this.webhookUrl,
        secret: this.webhookSecret,
        subscriptionId: null,
      });
    }

    if (deliveryTargets.length === 0) {
      return;
    }

    const payload: WebhookPayload = {
      event,
      tradeId,
      status,
      timestamp: new Date().toISOString(),
      data: metadata,
    };

    const body = JSON.stringify(payload);

    await Promise.allSettled(
      deliveryTargets.map((target) => this.sendWebhookWithRetry(target, body, tradeId, status)),
    );
  }

  private async sendWebhookWithRetry(
    target: DeliveryTarget,
    body: string,
    tradeId: string,
    status: TradeStatus,
  ): Promise<void> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const signature = target.secret
          ? crypto.createHmac("sha256", target.secret).update(body).digest("hex")
          : undefined;

        const response = await fetch(target.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(signature ? { "X-Webhook-Signature": signature } : {}),
          },
          body,
        });

        if (response.ok) {
          appLogger.debug(
            {
              tradeId,
              status,
              webhookUrl: target.url,
              subscriptionId: target.subscriptionId,
              attempt,
            },
            "Webhook dispatched successfully",
          );
          return;
        }

        const shouldRetry = response.status >= 500 || response.status === 429;
        const willRetry = shouldRetry && attempt < this.maxAttempts;
        const nextDelayMs = willRetry
          ? computeWebhookBackoffMs(attempt, this.retryBaseMs, this.retryMaxMs, this.random)
          : undefined;

        appLogger.warn(
          {
            tradeId,
            status,
            webhookUrl: target.url,
            subscriptionId: target.subscriptionId,
            statusCode: response.status,
            attempt,
            maxAttempts: this.maxAttempts,
            shouldRetry,
            ...(nextDelayMs !== undefined ? { nextDelayMs } : {}),
          },
          "Webhook delivery returned non-OK status",
        );

        if (!shouldRetry) {
          return;
        }

        lastError = new Error(`Webhook delivery returned HTTP ${response.status}`);

        if (!willRetry) {
          break;
        }

        await this.sleep(nextDelayMs!);
        continue;
      } catch (error) {
        lastError = error;
        const willRetry = attempt < this.maxAttempts;
        const nextDelayMs = willRetry
          ? computeWebhookBackoffMs(attempt, this.retryBaseMs, this.retryMaxMs, this.random)
          : undefined;

        appLogger.warn(
          {
            tradeId,
            status,
            webhookUrl: target.url,
            subscriptionId: target.subscriptionId,
            attempt,
            maxAttempts: this.maxAttempts,
            ...(nextDelayMs !== undefined ? { nextDelayMs } : {}),
            error,
          },
          "Webhook delivery attempt failed",
        );

        if (willRetry) {
          await this.sleep(nextDelayMs!);
        }
      }
    }

    appLogger.error(
      {
        tradeId,
        status,
        webhookUrl: target.url,
        subscriptionId: target.subscriptionId,
        attempts: this.maxAttempts,
        error: lastError,
      },
      "Webhook delivery failed after retries",
    );
  }

  isConfigured(): boolean {
    return !!this.webhookUrl;
  }
}

export const webhookService = new WebhookService();

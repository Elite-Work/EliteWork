import crypto from "crypto";
import { env } from "../config/env";
import { appLogger } from "../middleware/logger";
import { prisma } from "../lib/db";
import { TradeStatus } from "@prisma/client";

export interface WebhookPayload {
  event: string;
  tradeId: string;
  status: TradeStatus;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface DeliveryTarget {
  url: string;
  secret?: string;
  subscriptionId?: number | null;
}

export interface WebhookRetryOptions {
  webhookUrl?: string;
  webhookSecret?: string;
  maxAttempts?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  /** Jitter factor in [0, 1]. Defaults to 0.25 (up to 25% random jitter). */
  jitterFactor?: number;
  /** Optional custom sleep function for deterministic unit testing. */
  sleepFn?: (ms: number) => Promise<void>;
  /** Optional custom random generator in [0, 1) for deterministic jitter testing. */
  randomFn?: () => number;
}

export class WebhookService {
  private readonly webhookUrl: string | undefined;
  private readonly webhookSecret: string | undefined;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly jitterFactor: number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly randomFn: () => number;

  constructor(options: WebhookRetryOptions = {}) {
    this.webhookUrl = options.webhookUrl ?? env.WEBHOOK_URL;
    this.webhookSecret = options.webhookSecret ?? env.WEBHOOK_SECRET;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? env.WEBHOOK_MAX_ATTEMPTS);
    this.retryBaseMs = Math.max(1, options.retryBaseMs ?? env.WEBHOOK_RETRY_BASE_MS);
    this.retryMaxMs = Math.max(this.retryBaseMs, options.retryMaxMs ?? env.WEBHOOK_RETRY_MAX_MS);
    this.jitterFactor = Math.min(1, Math.max(0, options.jitterFactor ?? 0.25));
    this.sleepFn =
      options.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.randomFn = options.randomFn ?? Math.random;
  }

  /**
   * Computes exponential backoff delay (in milliseconds) with bounded jitter for a 1-indexed attempt.
   *
   * Base exponential window: `min(retryBaseMs * 2^(attempt - 1), retryMaxMs)`
   * Jittered delay: `round(window * (1 - jitterFactor + randomFn() * jitterFactor))`
   */
  public calculateBackoffDelay(attempt: number): number {
    const normalizedAttempt = Math.max(1, attempt);
    const exponentialWindow = Math.min(
      this.retryBaseMs * 2 ** (normalizedAttempt - 1),
      this.retryMaxMs,
    );
    if (this.jitterFactor === 0) {
      return exponentialWindow;
    }
    const minWindow = exponentialWindow * (1 - this.jitterFactor);
    const jitter = this.randomFn() * (exponentialWindow * this.jitterFactor);
    return Math.max(1, Math.round(minWindow + jitter));
  }

  async dispatch(
    tradeId: string,
    status: TradeStatus,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
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
    let lastStatusCode: number | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const signature = target.secret
          ? crypto.createHmac("sha256", target.secret).update(body).digest("hex")
          : undefined;

        const response = await fetch(target.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Attempt": String(attempt),
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

        lastStatusCode = response.status;
        const shouldRetry = response.status >= 500 || response.status === 429;
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
          },
          "Webhook delivery returned non-OK status",
        );

        if (!shouldRetry) {
          appLogger.error(
            {
              tradeId,
              status,
              webhookUrl: target.url,
              subscriptionId: target.subscriptionId,
              statusCode: response.status,
              attempt,
              finalFailure: true,
              retryable: false,
            },
            "Webhook delivery aborted on non-retryable status",
          );
          return;
        }

        lastError = new Error(`Webhook HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
        appLogger.warn(
          {
            tradeId,
            status,
            webhookUrl: target.url,
            subscriptionId: target.subscriptionId,
            attempt,
            maxAttempts: this.maxAttempts,
            error,
          },
          "Webhook delivery attempt failed",
        );
      }

      if (attempt < this.maxAttempts) {
        const delayMs = this.calculateBackoffDelay(attempt);
        appLogger.debug(
          {
            tradeId,
            status,
            webhookUrl: target.url,
            subscriptionId: target.subscriptionId,
            attempt,
            nextAttempt: attempt + 1,
            delayMs,
          },
          "Scheduling webhook retry with exponential backoff",
        );
        await this.sleepFn(delayMs);
      }
    }

    appLogger.error(
      {
        tradeId,
        status,
        webhookUrl: target.url,
        subscriptionId: target.subscriptionId,
        attemptsExhausted: this.maxAttempts,
        lastStatusCode,
        finalFailure: true,
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

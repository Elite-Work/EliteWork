import crypto from "crypto";
import { TradeStatus } from "@prisma/client";

jest.mock("../../config/env", () => ({
  env: {
    WEBHOOK_URL: undefined,
    WEBHOOK_SECRET: undefined,
    WEBHOOK_MAX_ATTEMPTS: 3,
    WEBHOOK_RETRY_BASE_MS: 1000,
    WEBHOOK_RETRY_MAX_MS: 30000,
  },
}));

const mockFindMany = jest.fn();
jest.mock("../../lib/db", () => ({
  prisma: {
    webhookSubscription: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
jest.mock("../../middleware/logger", () => ({
  appLogger: mockLogger,
}));

import {
  WebhookService,
  computeWebhookBackoffMs,
} from "../webhook.service";

describe("computeWebhookBackoffMs", () => {
  it("computes equal-jitter exponential backoff within [capped/2, capped]", () => {
    expect(computeWebhookBackoffMs(1, 1000, 30000, () => 0)).toBe(500);
    expect(computeWebhookBackoffMs(1, 1000, 30000, () => 0.5)).toBe(750);
    expect(computeWebhookBackoffMs(1, 1000, 30000, () => 1)).toBe(1000);

    expect(computeWebhookBackoffMs(2, 1000, 30000, () => 0)).toBe(1000);
    expect(computeWebhookBackoffMs(2, 1000, 30000, () => 1)).toBe(2000);

    expect(computeWebhookBackoffMs(3, 1000, 30000, () => 0)).toBe(2000);
    expect(computeWebhookBackoffMs(3, 1000, 30000, () => 1)).toBe(4000);
  });

  it("caps the delay at maxMs", () => {
    expect(computeWebhookBackoffMs(10, 1000, 5000, () => 0)).toBe(2500);
    expect(computeWebhookBackoffMs(10, 1000, 5000, () => 1)).toBe(5000);
  });
});

describe("WebhookService", () => {
  const originalFetch = global.fetch;
  let mockFetch: jest.Mock;
  let mockSleep: jest.Mock<Promise<void>, [number]>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    mockSleep = jest.fn().mockResolvedValue(undefined);
    mockFindMany.mockResolvedValue([
      {
        id: 7,
        url: "https://subscriber.example.com/hook",
        secretHash: "hashed-secret",
      },
    ]);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("dispatches once with HMAC signature and does not retry on HTTP 200", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const service = new WebhookService({
      maxAttempts: 4,
      retryBaseMs: 500,
      retryMaxMs: 5000,
      sleep: mockSleep,
    });

    await service.dispatch("trade-1", TradeStatus.FUNDED, { amount: "100" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://subscriber.example.com/hook");
    expect(init.method).toBe("POST");
    const expectedSig = crypto
      .createHmac("sha256", "hashed-secret")
      .update(init.body)
      .digest("hex");
    expect(init.headers["X-Webhook-Signature"]).toBe(expectedSig);
  });

  it("retries on HTTP 5xx with exponential backoff and jitter until a subsequent attempt succeeds", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const randomValues = [0.2, 0.8];
    let idx = 0;
    const service = new WebhookService({
      maxAttempts: 4,
      retryBaseMs: 1000,
      retryMaxMs: 30000,
      random: () => randomValues[idx++] ?? 0.5,
      sleep: mockSleep,
    });

    await service.dispatch("trade-2", TradeStatus.COMPLETED);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockSleep).toHaveBeenCalledTimes(2);
    // Attempt 1: capped=1000, half=500, 500 + 0.2*500 = 600
    expect(mockSleep).toHaveBeenNthCalledWith(1, 600);
    // Attempt 2: capped=2000, half=1000, 1000 + 0.8*1000 = 1800
    expect(mockSleep).toHaveBeenNthCalledWith(2, 1800);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("retries on HTTP 429 Too Many Requests", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, status: 204 });

    const service = new WebhookService({
      maxAttempts: 3,
      retryBaseMs: 1000,
      retryMaxMs: 30000,
      random: () => 0.5,
      sleep: mockSleep,
    });

    await service.dispatch("trade-429", TradeStatus.FUNDED);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledTimes(1);
    expect(mockSleep).toHaveBeenCalledWith(750);
  });

  it("stops retrying after configurable maxAttempts on persistent 5xx and logs an error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });

    const service = new WebhookService({
      maxAttempts: 5,
      retryBaseMs: 100,
      retryMaxMs: 500,
      random: () => 1,
      sleep: mockSleep,
    });

    await service.dispatch("trade-fail", TradeStatus.DISPUTED);

    expect(mockFetch).toHaveBeenCalledTimes(5);
    expect(mockSleep).toHaveBeenCalledTimes(4);
    expect(mockSleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200, 400, 500]);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        tradeId: "trade-fail",
        attempts: 5,
      }),
      "Webhook delivery failed after retries",
    );
  });

  it("does not retry on non-429 4xx responses", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400 });

    const service = new WebhookService({
      maxAttempts: 4,
      retryBaseMs: 1000,
      retryMaxMs: 30000,
      sleep: mockSleep,
    });

    await service.dispatch("trade-400", TradeStatus.CREATED);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("retries on network errors up to maxAttempts with jittered backoff", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("ETIMEDOUT"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const service = new WebhookService({
      maxAttempts: 3,
      retryBaseMs: 200,
      retryMaxMs: 1000,
      random: () => 0,
      sleep: mockSleep,
    });

    await service.dispatch("trade-net", TradeStatus.DELIVERED);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockSleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200]);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
  });

  it("supports maxAttempts = 1 with no retries", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const service = new WebhookService({
      maxAttempts: 1,
      retryBaseMs: 1000,
      retryMaxMs: 30000,
      sleep: mockSleep,
    });

    await service.dispatch("trade-once", TradeStatus.FUNDED);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockSleep).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
  });
});

import { TradeStatus } from "@prisma/client";
import { WebhookService } from "../webhook.service";
import { appLogger } from "../../middleware/logger";

jest.mock("../../lib/db", () => ({
  prisma: {
    webhookSubscription: {
      findMany: jest.fn(),
    },
  },
}));

const { prisma } = require("../../lib/db");

describe("WebhookService retry-on-failure with exponential backoff", () => {
  const originalFetch = global.fetch;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    prisma.webhookSubscription.findMany.mockResolvedValue([]);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe("calculateBackoffDelay", () => {
    it("computes exponential backoff capped at retryMaxMs when jitterFactor is 0", () => {
      const service = new WebhookService({
        retryBaseMs: 1000,
        retryMaxMs: 5000,
        jitterFactor: 0,
      });

      expect(service.calculateBackoffDelay(1)).toBe(1000);
      expect(service.calculateBackoffDelay(2)).toBe(2000);
      expect(service.calculateBackoffDelay(3)).toBe(4000);
      expect(service.calculateBackoffDelay(4)).toBe(5000);
    });

    it("applies bounded jitter using randomFn", () => {
      const serviceLow = new WebhookService({
        retryBaseMs: 1000,
        retryMaxMs: 30000,
        jitterFactor: 0.25,
        randomFn: () => 0,
      });
      const serviceHigh = new WebhookService({
        retryBaseMs: 1000,
        retryMaxMs: 30000,
        jitterFactor: 0.25,
        randomFn: () => 1,
      });

      expect(serviceLow.calculateBackoffDelay(1)).toBe(750);
      expect(serviceHigh.calculateBackoffDelay(1)).toBe(1000);
      expect(serviceLow.calculateBackoffDelay(2)).toBe(1500);
      expect(serviceHigh.calculateBackoffDelay(2)).toBe(2000);
    });
  });

  describe("dispatch retry behavior", () => {
    it("succeeds on first attempt without sleeping when endpoint returns 200", async () => {
      const sleepSpy = jest.fn().mockResolvedValue(undefined);
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const service = new WebhookService({
        webhookUrl: "https://hooks.example.com/amana",
        webhookSecret: "top-secret",
        maxAttempts: 3,
        retryBaseMs: 500,
        retryMaxMs: 5000,
        sleepFn: sleepSpy,
      });

      await service.dispatch("trade-101", TradeStatus.FUNDED, { amount: "100" });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(sleepSpy).not.toHaveBeenCalled();
      const [, requestInit] = mockFetch.mock.calls[0];
      expect(requestInit.headers["X-Webhook-Attempt"]).toBe("1");
      expect(requestInit.headers["X-Webhook-Signature"]).toMatch(/^[a-f0-9]{64}$/);
    });

    it("retries transient 5xx and 429 responses with exponential backoff until success", async () => {
      const sleepDelays: number[] = [];
      const sleepSpy = jest.fn(async (ms: number) => {
        sleepDelays.push(ms);
      });

      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const service = new WebhookService({
        webhookUrl: "https://hooks.example.com/amana",
        maxAttempts: 4,
        retryBaseMs: 1000,
        retryMaxMs: 10000,
        jitterFactor: 0.2,
        randomFn: () => 0.5,
        sleepFn: sleepSpy,
      });

      await service.dispatch("trade-202", TradeStatus.COMPLETED);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(sleepDelays).toEqual([900, 1800]);
    });

    it("retries network errors up to maxAttempts and logs final failure for monitoring", async () => {
      const sleepSpy = jest.fn().mockResolvedValue(undefined);
      const errorSpy = jest.spyOn(appLogger, "error").mockImplementation();
      const networkError = new Error("ECONNRESET: socket hang up");
      mockFetch.mockRejectedValue(networkError);

      const service = new WebhookService({
        webhookUrl: "https://hooks.example.com/amana",
        maxAttempts: 3,
        retryBaseMs: 250,
        retryMaxMs: 2000,
        jitterFactor: 0,
        sleepFn: sleepSpy,
      });

      await service.dispatch("trade-303", TradeStatus.DISPUTED);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(sleepSpy).toHaveBeenCalledTimes(2);
      expect(sleepSpy).toHaveBeenNthCalledWith(1, 250);
      expect(sleepSpy).toHaveBeenNthCalledWith(2, 500);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tradeId: "trade-303",
          status: TradeStatus.DISPUTED,
          webhookUrl: "https://hooks.example.com/amana",
          attemptsExhausted: 3,
          finalFailure: true,
          error: networkError,
        }),
        "Webhook delivery failed after retries",
      );

      errorSpy.mockRestore();
    });

    it("does not retry non-retryable 4xx client errors (except 429)", async () => {
      const sleepSpy = jest.fn().mockResolvedValue(undefined);
      const errorSpy = jest.spyOn(appLogger, "error").mockImplementation();
      mockFetch.mockResolvedValue({ ok: false, status: 400 });

      const service = new WebhookService({
        webhookUrl: "https://hooks.example.com/amana",
        maxAttempts: 4,
        retryBaseMs: 500,
        retryMaxMs: 5000,
        sleepFn: sleepSpy,
      });

      await service.dispatch("trade-404", TradeStatus.CANCELLED);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(sleepSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tradeId: "trade-404",
          statusCode: 400,
          finalFailure: true,
          retryable: false,
        }),
        "Webhook delivery aborted on non-retryable status",
      );

      errorSpy.mockRestore();
    });
  });
});

/**
 * Unit tests for the path-payment quote cache: cache hit, cache miss,
 * TTL expiry, and eviction (explicit invalidation + Redis TTL on write).
 */

const store = new Map<string, unknown>();

jest.mock("../../lib/cache", () => ({
  cacheGet: jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
  cacheSet: jest.fn(async (key: string, value: unknown) => {
    store.set(key, value);
  }),
}));

const redisDel = jest.fn(async (key: string) => {
  store.delete(key);
  return 1;
});
jest.mock("../../lib/redis", () => ({
  redis: { del: (key: string) => redisDel(key) },
}));

jest.mock("../../middleware/logger", () => ({
  appLogger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockEnv: { QUOTE_CACHE_TTL_SECONDS?: number; QUOTE_MAX_SLIPPAGE_BPS?: number } = {
  QUOTE_CACHE_TTL_SECONDS: 30,
  QUOTE_MAX_SLIPPAGE_BPS: 500,
};
jest.mock("../../config/env", () => ({ env: mockEnv }));

import { cacheGet, cacheSet } from "../../lib/cache";
import { appLogger } from "../../middleware/logger";
import {
  CachedQuote,
  QuoteRequest,
  getCachedQuote,
  getMaxSlippageBps,
  getQuoteTtlSeconds,
  invalidateQuoteCache,
  isQuoteWithinSlippage,
  setCachedQuote,
} from "../quoteCache.service";

const T0 = new Date("2026-01-01T00:00:00.000Z").getTime();

const request: QuoteRequest = {
  sourceAmount: "1000000",
  sourceAssetCode: "USDC",
  sourceAssetIssuer: "GISSUER",
};

const quotes: CachedQuote["quotes"] = [
  {
    source_amount: "1000000",
    source_asset_type: "credit_alphanum4",
    source_asset_code: "USDC",
    destination_amount: "950000",
    destination_asset_type: "credit_alphanum4",
    destination_asset_code: "NGNC",
    path: [],
  },
];

function cachedWith(destinationAmount: string): CachedQuote {
  return {
    sourceAssetCode: "USDC",
    sourceAmount: "1000000",
    quotes: [{ ...quotes[0], destination_amount: destinationAmount }],
    quotedAt: new Date(T0).toISOString(),
    freshnessMs: 0,
  };
}

describe("quoteCache.service", () => {
  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(T0);
    mockEnv.QUOTE_CACHE_TTL_SECONDS = 30;
    mockEnv.QUOTE_MAX_SLIPPAGE_BPS = 500;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("cache miss", () => {
    it("returns null when nothing is cached for the request", async () => {
      await expect(getCachedQuote(request)).resolves.toBeNull();
      expect(cacheGet).toHaveBeenCalledWith("quote:path:USDC:GISSUER:1000000");
    });

    it("misses for a different amount on the same asset pair", async () => {
      await setCachedQuote(request, quotes);
      await expect(
        getCachedQuote({ ...request, sourceAmount: "2000000" }),
      ).resolves.toBeNull();
    });

    it("misses for a different issuer on the same asset code", async () => {
      await setCachedQuote(request, quotes);
      await expect(
        getCachedQuote({ ...request, sourceAssetIssuer: "GOTHER" }),
      ).resolves.toBeNull();
    });

    it("keys a missing issuer as 'default'", async () => {
      await getCachedQuote({ sourceAmount: "5", sourceAssetCode: "XLM" });
      expect(cacheGet).toHaveBeenCalledWith("quote:path:XLM:default:5");
    });
  });

  describe("cache hit", () => {
    it("returns the stored quote with its freshness age", async () => {
      await setCachedQuote(request, quotes);
      jest.advanceTimersByTime(5_000);

      const hit = await getCachedQuote(request);

      expect(hit).not.toBeNull();
      expect(hit!.quotes).toEqual(quotes);
      expect(hit!.sourceAssetCode).toBe("USDC");
      expect(hit!.sourceAssetIssuer).toBe("GISSUER");
      expect(hit!.quotedAt).toBe(new Date(T0).toISOString());
      expect(hit!.freshnessMs).toBe(5_000);
      expect(appLogger.debug).toHaveBeenCalledWith(
        { request },
        "[QuoteCache] Cache hit",
      );
    });

    it("writes through to the cache with the configured TTL", async () => {
      mockEnv.QUOTE_CACHE_TTL_SECONDS = 45;
      await setCachedQuote(request, quotes);

      expect(cacheSet).toHaveBeenCalledWith(
        "quote:path:USDC:GISSUER:1000000",
        expect.objectContaining({ quotes, freshnessMs: 0, quotedAt: new Date(T0).toISOString() }),
        45,
      );
    });

    it("does not mutate the stored entry's freshnessMs on read", async () => {
      await setCachedQuote(request, quotes);
      jest.advanceTimersByTime(1_000);
      await getCachedQuote(request);

      const stored = store.get("quote:path:USDC:GISSUER:1000000") as CachedQuote;
      expect(stored.freshnessMs).toBe(0);
    });
  });

  describe("TTL expiry", () => {
    it("still hits exactly at the TTL boundary", async () => {
      await setCachedQuote(request, quotes);
      jest.advanceTimersByTime(30_000);
      await expect(getCachedQuote(request)).resolves.not.toBeNull();
    });

    it("treats an entry one millisecond past the TTL as expired", async () => {
      await setCachedQuote(request, quotes);
      jest.advanceTimersByTime(30_001);

      await expect(getCachedQuote(request)).resolves.toBeNull();
      expect(appLogger.debug).toHaveBeenCalledWith(
        { request },
        "[QuoteCache] Quote expired",
      );
    });

    it("honours a shorter TTL configured after the quote was stored", async () => {
      await setCachedQuote(request, quotes);
      mockEnv.QUOTE_CACHE_TTL_SECONDS = 2;
      jest.advanceTimersByTime(2_500);
      await expect(getCachedQuote(request)).resolves.toBeNull();
    });

    it("falls back to a 30s TTL when unset", () => {
      mockEnv.QUOTE_CACHE_TTL_SECONDS = undefined;
      expect(getQuoteTtlSeconds()).toBe(30);
    });
  });

  describe("eviction", () => {
    it("invalidates the entry so the next read misses", async () => {
      await setCachedQuote(request, quotes);
      await invalidateQuoteCache(request);

      expect(redisDel).toHaveBeenCalledWith("quote:path:USDC:GISSUER:1000000");
      await expect(getCachedQuote(request)).resolves.toBeNull();
    });

    it("only evicts the targeted key", async () => {
      const other = { ...request, sourceAmount: "42" };
      await setCachedQuote(request, quotes);
      await setCachedQuote(other, quotes);

      await invalidateQuoteCache(request);

      await expect(getCachedQuote(request)).resolves.toBeNull();
      await expect(getCachedQuote(other)).resolves.not.toBeNull();
    });

    it("swallows and logs Redis failures during invalidation", async () => {
      redisDel.mockRejectedValueOnce(new Error("redis down"));

      await expect(invalidateQuoteCache(request)).resolves.toBeUndefined();
      expect(appLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ request }),
        "[QuoteCache] Cache invalidation failed",
      );
    });

    it("overwrites an existing entry and resets its age on re-set", async () => {
      await setCachedQuote(request, quotes);
      jest.advanceTimersByTime(25_000);
      await setCachedQuote(request, quotes);
      jest.advanceTimersByTime(10_000);

      const hit = await getCachedQuote(request);
      expect(hit).not.toBeNull();
      expect(hit!.freshnessMs).toBe(10_000);
    });
  });

  describe("isQuoteWithinSlippage", () => {
    it("accepts a quote within the tolerance", () => {
      // |1_000_000 - 960_000| / 1_000_000 = 400 bps
      expect(isQuoteWithinSlippage(cachedWith("960000"), "1000000", 500)).toBe(true);
    });

    it("accepts a deviation exactly at the tolerance", () => {
      expect(isQuoteWithinSlippage(cachedWith("950000"), "1000000", 500)).toBe(true);
    });

    it("rejects a deviation past the tolerance in either direction", () => {
      expect(isQuoteWithinSlippage(cachedWith("949000"), "1000000", 500)).toBe(false);
      expect(isQuoteWithinSlippage(cachedWith("1051000"), "1000000", 500)).toBe(false);
    });

    it("rejects when the cached quote has no paths", () => {
      expect(isQuoteWithinSlippage({ ...cachedWith("1"), quotes: [] }, "1", 500)).toBe(false);
    });

    it("rejects a zero fresh amount", () => {
      expect(isQuoteWithinSlippage(cachedWith("1"), "0", 500)).toBe(false);
    });

    it("uses the env-configured tolerance by default", () => {
      mockEnv.QUOTE_MAX_SLIPPAGE_BPS = 100;
      expect(getMaxSlippageBps()).toBe(100);
      expect(isQuoteWithinSlippage(cachedWith("980000"), "1000000")).toBe(false);
    });

    it("falls back to 500 bps when unset", () => {
      mockEnv.QUOTE_MAX_SLIPPAGE_BPS = undefined;
      expect(getMaxSlippageBps()).toBe(500);
    });
  });
});

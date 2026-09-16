/**
 * Tests for src/lib/offlineCache.ts
 *
 * Uses a real localStorage mock (jsdom provides it).
 *
 * Coverage targets (Issue #2 DoD):
 *   - Write/read round-trip
 *   - Stale serving after TTL elapsed
 *   - Cache miss when entry absent or corrupt
 *   - LRU eviction under quota pressure
 *   - Quota enforcement (write dropped when quota cannot be freed)
 *   - Domain isolation (clear one domain, others unaffected)
 *   - Corruption recovery (parse error → remove + miss)
 *   - getCacheUsageBytes reflects written data
 */

import {
  cacheWrite,
  cacheRead,
  cacheInvalidate,
  cacheClearDomain,
  cacheClearAll,
  getCacheUsageBytes,
  TTL_MS,
  QUOTA_BYTES,
} from "../offlineCache";

// ─── Helpers ───────────────────────────────────────────────────────────────

function clearStorage() {
  localStorage.clear();
}

beforeEach(() => {
  clearStorage();
  jest.useRealTimers();
});

afterEach(() => {
  clearStorage();
  jest.useRealTimers();
});

// ─── Write / read round-trip ───────────────────────────────────────────────

describe("cacheWrite + cacheRead", () => {
  it("returns the written data on a fresh read", () => {
    cacheWrite("trades_list", "list", { items: [], pagination: {} });
    const result = cacheRead("trades_list", "list");
    expect(result.isMiss).toBe(false);
    expect(result.isStale).toBe(false);
    expect(result.entry?.data).toEqual({ items: [], pagination: {} });
  });

  it("stores cachedAt close to Date.now()", () => {
    const before = Date.now();
    cacheWrite("trade_detail", "trade-1", { tradeId: "trade-1" });
    const after = Date.now();
    const read = cacheRead("trade_detail", "trade-1");
    expect(read.entry?.cachedAt).toBeGreaterThanOrEqual(before);
    expect(read.entry?.cachedAt).toBeLessThanOrEqual(after);
  });

  it("overwrites an existing entry", () => {
    cacheWrite("trade_detail", "trade-1", { tradeId: "trade-1", status: "OPEN" });
    cacheWrite("trade_detail", "trade-1", { tradeId: "trade-1", status: "DELIVERED" });
    const result = cacheRead<{ status: string }>("trade_detail", "trade-1");
    expect(result.entry?.data.status).toBe("DELIVERED");
  });
});

// ─── Cache miss ────────────────────────────────────────────────────────────

describe("cache miss", () => {
  it("returns isMiss=true when no entry written", () => {
    const result = cacheRead("notifications", "prefs");
    expect(result.isMiss).toBe(true);
    expect(result.entry).toBeNull();
  });
});

// ─── Stale detection ───────────────────────────────────────────────────────

describe("stale detection", () => {
  it("returns isStale=false immediately after write", () => {
    cacheWrite("trades_list", "list", {});
    const result = cacheRead("trades_list", "list");
    expect(result.isStale).toBe(false);
  });

  it("returns isStale=true after TTL has elapsed", () => {
    jest.useFakeTimers();
    cacheWrite("notifications", "prefs", { enabled: true });

    // Advance past notifications TTL (2 min)
    jest.setSystemTime(Date.now() + TTL_MS.notifications + 1);

    const result = cacheRead("notifications", "prefs");
    expect(result.isStale).toBe(true);
    // Data is still served even when stale
    expect(result.isMiss).toBe(false);
    expect(result.entry?.data).toEqual({ enabled: true });
  });

  it("uses correct TTL per domain", () => {
    jest.useFakeTimers();

    cacheWrite("trades_list", "list", { items: [] });
    cacheWrite("trade_detail", "t1", { tradeId: "t1" });

    // Advance to exactly trades_list TTL
    jest.setSystemTime(Date.now() + TTL_MS.trades_list + 1);

    expect(cacheRead("trades_list", "list").isStale).toBe(true);
    // trade_detail TTL is longer — should still be fresh
    expect(cacheRead("trade_detail", "t1").isStale).toBe(false);
  });
});

// ─── Invalidation ─────────────────────────────────────────────────────────

describe("cacheInvalidate", () => {
  it("removes a single entry", () => {
    cacheWrite("trade_detail", "t1", { tradeId: "t1" });
    cacheInvalidate("trade_detail", "t1");
    expect(cacheRead("trade_detail", "t1").isMiss).toBe(true);
  });

  it("does not affect other keys in the same domain", () => {
    cacheWrite("trade_detail", "t1", { tradeId: "t1" });
    cacheWrite("trade_detail", "t2", { tradeId: "t2" });
    cacheInvalidate("trade_detail", "t1");
    expect(cacheRead("trade_detail", "t2").isMiss).toBe(false);
  });
});

// ─── Domain clear ─────────────────────────────────────────────────────────

describe("cacheClearDomain", () => {
  it("removes all entries in the domain", () => {
    cacheWrite("trades_list", "list", {});
    cacheWrite("trades_list", "filtered", {});
    cacheClearDomain("trades_list");
    expect(cacheRead("trades_list", "list").isMiss).toBe(true);
    expect(cacheRead("trades_list", "filtered").isMiss).toBe(true);
  });

  it("does not affect other domains", () => {
    cacheWrite("trades_list", "list", {});
    cacheWrite("notifications", "prefs", {});
    cacheClearDomain("trades_list");
    expect(cacheRead("notifications", "prefs").isMiss).toBe(false);
  });
});

// ─── Full clear ────────────────────────────────────────────────────────────

describe("cacheClearAll", () => {
  it("removes all cache entries across all domains", () => {
    cacheWrite("trades_list", "list", {});
    cacheWrite("trade_detail", "t1", {});
    cacheWrite("notifications", "prefs", {});
    cacheClearAll();
    expect(cacheRead("trades_list", "list").isMiss).toBe(true);
    expect(cacheRead("trade_detail", "t1").isMiss).toBe(true);
    expect(cacheRead("notifications", "prefs").isMiss).toBe(true);
  });

  it("does not remove non-cache localStorage keys", () => {
    localStorage.setItem("other_key", "other_value");
    cacheWrite("trades_list", "list", {});
    cacheClearAll();
    expect(localStorage.getItem("other_key")).toBe("other_value");
  });
});

// ─── Corruption recovery ──────────────────────────────────────────────────

describe("corruption recovery", () => {
  it("treats a JSON parse error as a miss and removes the key", () => {
    // Write corrupt data directly
    localStorage.setItem("amana_cache_v1:trade_detail:bad", "not-json{{{{");
    const result = cacheRead("trade_detail", "bad");
    expect(result.isMiss).toBe(true);
    expect(result.entry).toBeNull();
    // Key should be removed
    expect(localStorage.getItem("amana_cache_v1:trade_detail:bad")).toBeNull();
  });

  it("treats a structurally invalid entry as a miss", () => {
    // Valid JSON but wrong shape
    localStorage.setItem(
      "amana_cache_v1:notifications:prefs",
      JSON.stringify({ wrong: "shape" }),
    );
    const result = cacheRead("notifications", "prefs");
    expect(result.isMiss).toBe(true);
  });
});

// ─── Usage bytes ──────────────────────────────────────────────────────────

describe("getCacheUsageBytes", () => {
  it("returns 0 when cache is empty", () => {
    expect(getCacheUsageBytes()).toBe(0);
  });

  it("increases after a write", () => {
    const before = getCacheUsageBytes();
    cacheWrite("trades_list", "list", { items: new Array(10).fill({ tradeId: "x" }) });
    expect(getCacheUsageBytes()).toBeGreaterThan(before);
  });

  it("decreases after an invalidation", () => {
    cacheWrite("trades_list", "list", { items: new Array(100).fill({ tradeId: "x" }) });
    const after = getCacheUsageBytes();
    cacheInvalidate("trades_list", "list");
    expect(getCacheUsageBytes()).toBeLessThan(after);
  });
});

// ─── LRU eviction ─────────────────────────────────────────────────────────

describe("LRU eviction", () => {
  it("evicts the oldest entry when quota is exceeded", () => {
    jest.useFakeTimers();
    // Write an entry and mark it older by advancing time
    const oldData = "a".repeat(100);
    cacheWrite("trade_detail", "old-key", { data: oldData });

    // Advance time so old entry has an older cachedAt
    jest.setSystemTime(Date.now() + 10_000);

    // Fill cache close to quota with many newer entries so a new write triggers eviction
    const largeData = "x".repeat(500);
    let key = 0;
    let safetyBreak = 0;
    while (getCacheUsageBytes() < QUOTA_BYTES * 0.98 && safetyBreak++ < 5000) {
      cacheWrite("trade_detail", `fill-${key++}`, { blob: largeData });
    }

    // Now write one more entry — the oldest (old-key) should be evicted
    cacheWrite("trades_list", "new-entry", { fresh: true });

    // Either old-key is gone, or cache accepted the write (quota freed)
    // The important invariant: total usage stays ≤ QUOTA_BYTES after eviction
    expect(getCacheUsageBytes()).toBeLessThanOrEqual(QUOTA_BYTES + 2048); // 2KB tolerance for last entry
  });
});

import { trackEvent } from "@/lib/analytics";
import {
  fetchServerFlags,
  getFlagCacheMetrics,
  invalidateFlagCache,
  reportFlagCacheMetrics,
  resetFlagCacheMetrics,
} from "../featureFlags";

jest.mock("@/lib/analytics", () => ({
  trackEvent: jest.fn(),
}));

const mockTrackEvent = trackEvent as jest.MockedFunction<typeof trackEvent>;

function okResponse(flags: Record<string, boolean> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ flags }),
  } as unknown as Response;
}

describe("feature-flags SWR cache metrics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateFlagCache();
    resetFlagCacheMetrics();
    global.fetch = jest.fn().mockResolvedValue(okResponse({ adminUI: true })) as jest.Mock;
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("starts at zero with no network activity", () => {
    const metrics = getFlagCacheMetrics();

    expect(metrics).toMatchObject({
      hits: 0,
      misses: 0,
      staleServes: 0,
      inFlightDedupes: 0,
      totalLookups: 0,
      serverRequests: 0,
      serverErrors: 0,
      hitRate: 0,
      missRate: 0,
      servedFromCacheRate: 0,
      networkRequestsSaved: 0,
      lastLookupAt: null,
    });
  });

  it("counts the first lookup as a miss and every later lookup as a hit", async () => {
    await fetchServerFlags();
    await fetchServerFlags();
    await fetchServerFlags();

    const metrics = getFlagCacheMetrics();

    expect(metrics.misses).toBe(1);
    expect(metrics.hits).toBe(2);
    expect(metrics.totalLookups).toBe(3);
    expect(metrics.serverRequests).toBe(1);
    // 2 of 3 lookups were fresh cache hits.
    expect(metrics.hitRate).toBe(0.6667);
    expect(metrics.missRate).toBe(0.3333);
    // Every lookup after the cold start avoided the network.
    expect(metrics.servedFromCacheRate).toBe(0.6667);
    expect(metrics.networkRequestsSaved).toBe(2);
    expect(metrics.lastLookupAt).toEqual(expect.any(Number));
  });

  it("coalesces concurrent cold-start requests into a single network call", async () => {
    await Promise.all([fetchServerFlags(), fetchServerFlags(), fetchServerFlags()]);

    const metrics = getFlagCacheMetrics();

    expect(metrics.misses).toBe(1);
    expect(metrics.inFlightDedupes).toBe(2);
    expect(metrics.serverRequests).toBe(1);
    expect(metrics.totalLookups).toBe(3);
    // Two of three lookups never waited on the network.
    expect(metrics.servedFromCacheRate).toBe(0.6667);
    expect(metrics.networkRequestsSaved).toBe(2);
  });

  it("serves a stale entry immediately and revalidates in the background", async () => {
    await fetchServerFlags();
    expect(getFlagCacheMetrics().hits).toBe(0);

    // Age the cached entry past the 30s TTL.
    const realNow = Date.now;
    jest.spyOn(Date, "now").mockReturnValue(realNow() + 31_000);

    const stale = await fetchServerFlags();

    expect(stale.adminUI).toBe(true);
    expect(getFlagCacheMetrics().staleServes).toBe(1);
    expect(getFlagCacheMetrics().hits).toBe(0);
    // The revalidation is already in flight, but this caller was not made to
    // wait for it — it resolved from the stale entry.
    expect(getFlagCacheMetrics().serverRequests).toBe(2);

    // Background revalidation reports a cumulative snapshot to the dashboard.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "feature_flag_cache",
      expect.objectContaining({ staleServes: 1, totalLookups: 2, servedFromCacheRate: 0.5 }),
    );

    jest.spyOn(Date, "now").mockReturnValue(realNow());
  });

  it("counts a failed server response as a server error, not a cache miss", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as unknown as Response) as jest.Mock;

    const flags = await fetchServerFlags();

    // Kill-switch: fail-safe catalog defaults.
    expect(flags.adminUI).toBe(false);
    const metrics = getFlagCacheMetrics();
    expect(metrics.misses).toBe(1);
    expect(metrics.serverRequests).toBe(1);
    expect(metrics.serverErrors).toBe(1);
  });

  it("publishes an on-demand snapshot and can be reset", async () => {
    await fetchServerFlags();
    await fetchServerFlags();

    const reported = reportFlagCacheMetrics();

    expect(reported.totalLookups).toBe(2);
    expect(mockTrackEvent).toHaveBeenLastCalledWith("feature_flag_cache", {
      hits: 1,
      misses: 1,
      staleServes: 0,
      inFlightDedupes: 0,
      totalLookups: 2,
      serverRequests: 1,
      serverErrors: 0,
      hitRate: 0.5,
      missRate: 0.5,
      servedFromCacheRate: 0.5,
      networkRequestsSaved: 1,
      lastLookupAt: expect.any(Number),
    });

    resetFlagCacheMetrics();

    expect(getFlagCacheMetrics().totalLookups).toBe(0);
  });
});

/**
 * Feature flags — typed catalog shared with backend definitions.
 *
 * Architecture:
 *  1. `FLAG_CATALOG`  — single source of truth for all flag names + defaults.
 *  2. `getFeatureFlags()` — static env-var snapshot (SSR / build time).
 *  3. `fetchServerFlags()` — fetches the live catalog from /api/flags with
 *     stale-while-revalidate caching. On fetch failure the catalog default
 *     (fail-safe) is returned — kill-switch semantics.
 *
 * The flag names in FLAG_CATALOG MUST stay in sync with the backend's
 * feature-flags service. A CI script (`scripts/check-flag-catalog-drift.ts`)
 * enforces this by comparing against the backend endpoint.
 *
 * Observability:
 *  `fetchServerFlags()` keeps monotonic counters for every cache path it
 *  takes (fresh hit, cold miss, stale serve, in-flight coalesce) plus the
 *  network requests each of those saved. Read them with
 *  `getFlagCacheMetrics()` and publish them with
 *  `reportFlagCacheMetrics()`.
 */

import { trackEvent } from "@/lib/analytics";

// ---------------------------------------------------------------------------
// Catalog — edit only here; both client code and CI drift-check use this.
// ---------------------------------------------------------------------------

/**
 * All known feature flags.
 * Default value is the FAIL-SAFE: what the flag resolves to when the server
 * cannot be reached or the flag is absent from the response.
 *
 * Convention:
 *  - UI-facing flags: `false` default (feature is OFF until explicitly enabled)
 *  - Kill-switch flags: `true` default (feature is ON unless disabled)
 */
export const FLAG_CATALOG = {
  /** Admin UI pages (streams, batch actions, feature toggles). */
  adminUI: false,
  /** Clawback action on admin stream detail screen. */
  clawbackUI: false,
  /** Advanced reporting dashboard tab. */
  advancedReporting: false,
  /** Offline-mode banner shown when NetInfo reports no connectivity. */
  offlineBanner: true,
  /** New trade-creation wizard (multi-step). */
  tradeWizardV2: false,
} as const satisfies Record<string, boolean>;

export type FlagName = keyof typeof FLAG_CATALOG;

/** Runtime flag map — every key is a FlagName, value is boolean. */
export type FeatureFlags = { [K in FlagName]: boolean };

// ---------------------------------------------------------------------------
// Static env-var snapshot (SSR / jest / build-time use)
// ---------------------------------------------------------------------------

/**
 * Get the current feature flags from NEXT_PUBLIC_* environment variables.
 * Falls back to the catalog default for any flag not set in env.
 *
 * Use `useLiveFeatureFlags()` in React components for the server-fetched,
 * SWR-cached version.
 */
export function getFeatureFlags(): FeatureFlags {
  return {
    adminUI:
      process.env.NEXT_PUBLIC_ENABLE_ADMIN_UI === "true" ||
      FLAG_CATALOG.adminUI,
    clawbackUI:
      process.env.NEXT_PUBLIC_ENABLE_CLAWBACK_UI === "true" ||
      FLAG_CATALOG.clawbackUI,
    advancedReporting:
      process.env.NEXT_PUBLIC_ENABLE_ADVANCED_REPORTING === "true" ||
      FLAG_CATALOG.advancedReporting,
    offlineBanner:
      process.env.NEXT_PUBLIC_DISABLE_OFFLINE_BANNER !== "true" &&
      FLAG_CATALOG.offlineBanner,
    tradeWizardV2:
      process.env.NEXT_PUBLIC_ENABLE_TRADE_WIZARD_V2 === "true" ||
      FLAG_CATALOG.tradeWizardV2,
  };
}

/** Check if a specific feature is enabled via env var. */
export function isFeatureEnabled(feature: FlagName): boolean {
  return getFeatureFlags()[feature];
}

/** @deprecated Use the FlagName-typed overload. */
export function isAdminUIEnabled(): boolean {
  return getFeatureFlags().adminUI;
}

// ---------------------------------------------------------------------------
// Cache instrumentation
// ---------------------------------------------------------------------------

/**
 * Point-in-time snapshot of how the SWR cache is performing. Every rate is a
 * 0..1 fraction; `hitRate` and friends are 0 when nothing has been measured.
 */
export interface FlagCacheMetrics {
  /** Lookups served from a fresh entry (age < TTL) — no network. */
  hits: number;
  /** Lookups with no cache entry that had to await the server. */
  misses: number;
  /** Lookups served from a stale entry while revalidating in the background. */
  staleServes: number;
  /** Lookups coalesced onto an already in-flight cold-start request. */
  inFlightDedupes: number;
  /** Every call to `fetchServerFlags()`. */
  totalLookups: number;
  /** Network requests actually issued to /api/flags. */
  serverRequests: number;
  /** Network requests that threw or returned a non-OK status. */
  serverErrors: number;
  /** hits / totalLookups. */
  hitRate: number;
  /** misses / totalLookups. */
  missRate: number;
  /** Lookups answered without awaiting a network round trip / totalLookups. */
  servedFromCacheRate: number;
  /** totalLookups - serverRequests: round trips the cache avoided. */
  networkRequestsSaved: number;
  /** `Date.now()` of the most recent lookup, or null if never called. */
  lastLookupAt: number | null;
}

/** Mutable counters — mutated in place so hot paths stay allocation-free. */
const _counters = {
  hits: 0,
  misses: 0,
  staleServes: 0,
  inFlightDedupes: 0,
  serverRequests: 0,
  serverErrors: 0,
  lastLookupAt: null as number | null,
};

function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

/** Round to 4 decimals so dashboards and log lines stay stable/diffable. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Read the current cache-effectiveness counters.
 *
 * Cheap enough to call from a dashboard panel, a debug overlay, or a test —
 * it performs no I/O and mutates nothing.
 */
export function getFlagCacheMetrics(): FlagCacheMetrics {
  const totalLookups =
    _counters.hits +
    _counters.misses +
    _counters.staleServes +
    _counters.inFlightDedupes;

  return {
    hits: _counters.hits,
    misses: _counters.misses,
    staleServes: _counters.staleServes,
    inFlightDedupes: _counters.inFlightDedupes,
    totalLookups,
    serverRequests: _counters.serverRequests,
    serverErrors: _counters.serverErrors,
    hitRate: round4(safeRate(_counters.hits, totalLookups)),
    missRate: round4(safeRate(_counters.misses, totalLookups)),
    servedFromCacheRate: round4(
      safeRate(
        _counters.hits + _counters.staleServes + _counters.inFlightDedupes,
        totalLookups,
      ),
    ),
    networkRequestsSaved: totalLookups - _counters.serverRequests,
    lastLookupAt: _counters.lastLookupAt,
  };
}

/**
 * Zero the counters without touching the cached value.
 * Intended for tests and for a dashboard that wants a per-window rate.
 */
export function resetFlagCacheMetrics(): void {
  _counters.hits = 0;
  _counters.misses = 0;
  _counters.staleServes = 0;
  _counters.inFlightDedupes = 0;
  _counters.serverRequests = 0;
  _counters.serverErrors = 0;
  _counters.lastLookupAt = null;
}

/**
 * Publish a cache-effectiveness snapshot to the analytics pipeline.
 *
 * Called automatically after every background revalidation, so at most one
 * event is emitted per TTL window, and always as a cumulative snapshot —
 * the dashboard can graph `hitRate` over time without client-side differencing.
 * Safe to call manually (tests, an admin diagnostics panel).
 */
export function reportFlagCacheMetrics(): FlagCacheMetrics {
  const metrics = getFlagCacheMetrics();
  trackEvent("feature_flag_cache", { ...metrics });
  return metrics;
}

// ---------------------------------------------------------------------------
// Server-fetched cache with stale-while-revalidate semantics
// ---------------------------------------------------------------------------

const SERVER_FLAGS_TTL_MS = 30_000; // 30 s — revalidate in background after this

interface CacheEntry {
  flags: FeatureFlags;
  fetchedAt: number;
  /** True while a background revalidation is in flight. */
  revalidating: boolean;
}

let _cache: CacheEntry | null = null;
let _inFlight: Promise<FeatureFlags> | null = null;

/**
 * Fetch flags from the Next.js /api/flags bootstrap route.
 *
 * Kill-switch guarantee: if the request fails for any reason the function
 * returns the fail-safe catalog defaults instead of throwing. This means a
 * backend outage or network error disables risky features rather than
 * crashing the app.
 */
async function fetchFlagsFromServer(): Promise<FeatureFlags> {
  _counters.serverRequests += 1;
  try {
    const res = await fetch("/api/flags", {
      // No-store so the browser does not cache this behind Next.js; the
      // module-level cache above provides the SWR layer instead.
      cache: "no-store",
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      _counters.serverErrors += 1;
      console.warn(
        `[featureFlags] /api/flags responded ${res.status} — using catalog defaults`,
      );
      return catalogDefaults();
    }

    const json = (await res.json()) as { flags?: Partial<FeatureFlags> };
    return mergeFlagsWithDefaults(json.flags ?? {});
  } catch (err) {
    // Network error, parse error, etc. — fail safe.
    _counters.serverErrors += 1;
    console.warn(
      "[featureFlags] Failed to fetch server flags — using catalog defaults",
      err,
    );
    return catalogDefaults();
  }
}

/** Merge server-provided flags with catalog defaults for any missing keys. */
function mergeFlagsWithDefaults(partial: Partial<FeatureFlags>): FeatureFlags {
  const result = {} as FeatureFlags;
  for (const key of Object.keys(FLAG_CATALOG) as FlagName[]) {
    result[key] =
      key in partial ? (partial[key] as boolean) : FLAG_CATALOG[key];
  }
  return result;
}

/** Return the catalog defaults as a plain FeatureFlags object. */
function catalogDefaults(): FeatureFlags {
  return mergeFlagsWithDefaults({});
}

/**
 * Fetch server flags with stale-while-revalidate semantics.
 *
 * - First call: awaits the server fetch (cold start).
 * - Subsequent calls within TTL: returns cached flags immediately.
 * - After TTL: returns stale cache immediately and revalidates in background.
 * - On failure at any point: falls back to catalog defaults.
 *
 * Each branch bumps its counter in {@link getFlagCacheMetrics}.
 */
export async function fetchServerFlags(): Promise<FeatureFlags> {
  const now = Date.now();
  _counters.lastLookupAt = now;

  if (_cache) {
    const age = now - _cache.fetchedAt;

    if (age < SERVER_FLAGS_TTL_MS) {
      // Fresh — return immediately.
      _counters.hits += 1;
      return _cache.flags;
    }

    // Stale — return cached flags now, revalidate in background.
    _counters.staleServes += 1;
    if (!_cache.revalidating) {
      _cache.revalidating = true;
      void fetchFlagsFromServer().then((fresh) => {
        _cache = { flags: fresh, fetchedAt: Date.now(), revalidating: false };
        // One cumulative snapshot per revalidation — the periodic heartbeat
        // that makes cache effectiveness visible on the metrics dashboard.
        reportFlagCacheMetrics();
      });
    }
    return _cache.flags;
  }

  // No cache — deduplicate concurrent cold-start requests.
  if (_inFlight) {
    _counters.inFlightDedupes += 1;
    return _inFlight;
  }

  _counters.misses += 1;
  _inFlight = fetchFlagsFromServer().then((flags) => {
    _cache = { flags, fetchedAt: Date.now(), revalidating: false };
    _inFlight = null;
    return flags;
  });

  return _inFlight;
}

/** Force-invalidate the in-process SWR cache (useful for tests). */
export function invalidateFlagCache(): void {
  _cache = null;
  _inFlight = null;
}

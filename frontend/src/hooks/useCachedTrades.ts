"use client";

/**
 * Stale-while-revalidate hook for the trades list.
 *
 * Behaviour
 * ─────────
 * 1. On mount (or refetch): read cache immediately → return to UI.
 * 2. If online: fetch fresh data in background → write to cache → re-render.
 * 3. If offline: serve cached data with `isStale` flag; UI shows staleness badge.
 * 4. `cachedAt` is exposed so the UI can display "Last updated N minutes ago".
 *
 * The returned `refetch` is intentionally not async in the component sense —
 * callers do not need to await it; state updates trigger re-renders.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useOffline } from "./useOffline";
import { useAuth } from "./useAuth";
import { api, ApiError } from "@/lib/api";
import {
  cacheRead,
  cacheWrite,
  cacheInvalidate,
} from "@/lib/offlineCache";
import type { TradeListResponse } from "@/lib/api/types";

const DOMAIN = "trades_list" as const;

export interface TradesListParams {
  status?: string;
  page?: number;
  limit?: number;
}

export interface UseCachedTradesResult {
  data: TradeListResponse | null;
  isLoading: boolean;
  isStale: boolean;
  /** ISO timestamp of the last successful cache write, or null. */
  cachedAt: number | null;
  error: string | null;
  refetch: () => void;
  /** Invalidates cache and triggers a fresh fetch. */
  invalidateAndRefetch: () => void;
}

function paramsKey(params?: TradesListParams): string {
  return JSON.stringify({
    status: params?.status ?? "",
    page: params?.page ?? 1,
    limit: params?.limit ?? 20,
  });
}

export function useCachedTrades(
  params?: TradesListParams,
): UseCachedTradesResult {
  const { isOffline } = useOffline();
  const { token, isAuthenticated } = useAuth();

  const cacheKey = paramsKey(params);

  // Seed state from cache on first render
  const initialRead = cacheRead<TradeListResponse>(DOMAIN, cacheKey);
  const [data, setData] = useState<TradeListResponse | null>(
    initialRead.entry?.data ?? null,
  );
  const [isStale, setIsStale] = useState(initialRead.isStale);
  const [cachedAt, setCachedAt] = useState<number | null>(
    initialRead.entry?.cachedAt ?? null,
  );
  const [isLoading, setIsLoading] = useState(initialRead.isMiss);
  const [error, setError] = useState<string | null>(null);

  // Track whether a fetch is in flight to avoid double-firing
  const fetchingRef = useRef(false);

  const fetchFresh = useCallback(async () => {
    if (!isAuthenticated || !token || isOffline || fetchingRef.current) return;

    fetchingRef.current = true;
    setError(null);

    try {
      const fresh = await api.trades.list(token, params);
      cacheWrite(DOMAIN, cacheKey, fresh);
      setData(fresh);
      setIsStale(false);
      setCachedAt(Date.now());
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load trades";
      setError(msg);
    } finally {
      setIsLoading(false);
      fetchingRef.current = false;
    }
  }, [isAuthenticated, token, isOffline, params, cacheKey]);

  // Re-read cache when params change. Intentional imperative sync with an
  // external cache keyed by a derived value, not expressible as render-time
  // state derivation.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const read = cacheRead<TradeListResponse>(DOMAIN, cacheKey);
    if (read.entry) {
      setData(read.entry.data);
      setIsStale(read.isStale);
      setCachedAt(read.entry.cachedAt);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
  }, [cacheKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Trigger background revalidation when online. setState happens inside
  // fetchFresh's async body, not synchronously in the effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isOffline && isAuthenticated && token) {
      void fetchFresh();
    }
  }, [isOffline, isAuthenticated, token, fetchFresh]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const refetch = useCallback(() => {
    void fetchFresh();
  }, [fetchFresh]);

  const invalidateAndRefetch = useCallback(() => {
    cacheInvalidate(DOMAIN, cacheKey);
    setData(null);
    setIsLoading(true);
    setIsStale(false);
    setCachedAt(null);
    void fetchFresh();
  }, [fetchFresh, cacheKey]);

  return { data, isLoading, isStale, cachedAt, error, refetch, invalidateAndRefetch };
}

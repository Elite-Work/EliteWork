"use client";

/**
 * Stale-while-revalidate hook for a single trade detail.
 *
 * Replaces the bare `useTradeDetail` hook with an offline-capable version.
 * The original hook continues to work for callers that do not need offline
 * support; this one is used on the trade detail page.
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
import type { TradeResponse } from "@/lib/api/types";

const DOMAIN = "trade_detail" as const;

export interface UseCachedTradeDetailResult {
  trade: TradeResponse | null;
  isLoading: boolean;
  isStale: boolean;
  cachedAt: number | null;
  error: string | null;
  refetch: () => void;
  invalidateAndRefetch: () => void;
}

export function useCachedTradeDetail(
  tradeId: string,
): UseCachedTradeDetailResult {
  const { isOffline } = useOffline();
  const { token, isAuthenticated } = useAuth();

  const initialRead = cacheRead<TradeResponse>(DOMAIN, tradeId);
  const [trade, setTrade] = useState<TradeResponse | null>(
    initialRead.entry?.data ?? null,
  );
  const [isStale, setIsStale] = useState(initialRead.isStale);
  const [cachedAt, setCachedAt] = useState<number | null>(
    initialRead.entry?.cachedAt ?? null,
  );
  const [isLoading, setIsLoading] = useState(initialRead.isMiss);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  const fetchFresh = useCallback(async () => {
    if (!isAuthenticated || !token || isOffline || fetchingRef.current) return;

    fetchingRef.current = true;
    setError(null);

    try {
      const fresh = await api.trades.get(token, tradeId);
      cacheWrite(DOMAIN, tradeId, fresh);
      setTrade(fresh);
      setIsStale(false);
      setCachedAt(Date.now());
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load trade";
      setError(msg);
    } finally {
      setIsLoading(false);
      fetchingRef.current = false;
    }
  }, [isAuthenticated, token, isOffline, tradeId]);

  // Re-read cache when tradeId changes. Intentional imperative sync with an
  // external cache, and background revalidation whose setState calls happen
  // inside fetchFresh's async body — not synchronously in the effect.
  useEffect(() => {
    const read = cacheRead<TradeResponse>(DOMAIN, tradeId);
    if (read.entry) {
      setTrade(read.entry.data);
      setIsStale(read.isStale);
      setCachedAt(read.entry.cachedAt);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
  }, [tradeId]);

  useEffect(() => {
    if (!isOffline && isAuthenticated && token) {
      void fetchFresh();
    }
  }, [isOffline, isAuthenticated, token, fetchFresh]);

  const refetch = useCallback(() => void fetchFresh(), [fetchFresh]);

  const invalidateAndRefetch = useCallback(() => {
    cacheInvalidate(DOMAIN, tradeId);
    setTrade(null);
    setIsLoading(true);
    setIsStale(false);
    setCachedAt(null);
    void fetchFresh();
  }, [fetchFresh, tradeId]);

  return { trade, isLoading, isStale, cachedAt, error, refetch, invalidateAndRefetch };
}

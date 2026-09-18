"use client";

/**
 * Stale-while-revalidate hook for notification preferences / notification list.
 *
 * The notifications domain has a shorter TTL (2 min) because staleness is
 * most visible here. The hook is intentionally generic over the payload shape
 * so it can serve both the notification preferences endpoint and any future
 * notification feed endpoint without a rewrite.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useOffline } from "./useOffline";
import { useAuth } from "./useAuth";
import { request, ApiError } from "@/lib/api/client";
import {
  cacheRead,
  cacheWrite,
  cacheInvalidate,
} from "@/lib/offlineCache";

const DOMAIN = "notifications" as const;

export interface UseCachedNotificationsOptions {
  /** API endpoint to fetch, e.g. "/notifications/preferences". */
  endpoint: string;
  /** Cache key — defaults to endpoint. */
  cacheKey?: string;
}

export interface UseCachedNotificationsResult<T> {
  data: T | null;
  isLoading: boolean;
  isStale: boolean;
  cachedAt: number | null;
  error: string | null;
  refetch: () => void;
  invalidateAndRefetch: () => void;
}

export function useCachedNotifications<T>(
  options: UseCachedNotificationsOptions,
): UseCachedNotificationsResult<T> {
  const { endpoint, cacheKey = endpoint } = options;
  const { isOffline } = useOffline();
  const { token, isAuthenticated } = useAuth();

  const initialRead = cacheRead<T>(DOMAIN, cacheKey);
  const [data, setData] = useState<T | null>(
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
      const fresh = await request<T>(endpoint, { token });
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
            : "Failed to load notifications";
      setError(msg);
    } finally {
      setIsLoading(false);
      fetchingRef.current = false;
    }
  }, [isAuthenticated, token, isOffline, endpoint, cacheKey]);

  // Re-read cache when cacheKey changes, and background revalidation whose
  // setState calls happen inside fetchFresh's async body — not synchronously
  // in the effect.
  useEffect(() => {
    const read = cacheRead<T>(DOMAIN, cacheKey);
    if (read.entry) {
      setData(read.entry.data);
      setIsStale(read.isStale);
      setCachedAt(read.entry.cachedAt);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
  }, [cacheKey]);

  useEffect(() => {
    if (!isOffline && isAuthenticated && token) {
      void fetchFresh();
    }
  }, [isOffline, isAuthenticated, token, fetchFresh]);

  const refetch = useCallback(() => void fetchFresh(), [fetchFresh]);

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

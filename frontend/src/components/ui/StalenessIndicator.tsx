"use client";

/**
 * StalenessIndicator — shows how fresh cached data is.
 *
 * Rendered inline next to section headings when:
 *   - `isStale` is true  →  amber "Stale" badge with elapsed time
 *   - `isOffline` is true AND data exists  →  grey "Offline" badge
 *   - data is live  →  nothing rendered (no badge)
 *
 * Usage:
 *   <StalenessIndicator isStale={isStale} cachedAt={cachedAt} isOffline={isOffline} />
 */

import { clsx } from "clsx";

interface StalenessIndicatorProps {
  isStale: boolean;
  isOffline: boolean;
  /** Unix ms timestamp from CacheEntry.cachedAt */
  cachedAt: number | null;
  className?: string;
}

function formatElapsed(ms: number): string {
  if (ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export function StalenessIndicator({
  isStale,
  isOffline,
  cachedAt,
  className,
}: StalenessIndicatorProps) {
  if (!isStale && !isOffline) return null;

  // Reads the current time to render a "how long ago" label; this component
  // doesn't need to live-tick, so an approximate value from render time is
  // intentional here.
  // eslint-disable-next-line react-hooks/purity
  const elapsed = cachedAt ? Date.now() - cachedAt : null;
  const label = isOffline ? "Offline" : "Stale";
  const timeLabel = elapsed !== null ? formatElapsed(elapsed) : null;

  return (
    <span
      role="status"
      aria-label={
        isOffline
          ? "Showing offline cached data"
          : `Showing stale data cached ${timeLabel ?? "recently"}`
      }
      data-testid="staleness-indicator"
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        isOffline
          ? "bg-bg-elevated text-text-muted border border-border-default"
          : "bg-status-warning/10 text-status-warning border border-status-warning/20",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          "h-1.5 w-1.5 rounded-full flex-shrink-0",
          isOffline ? "bg-text-muted" : "bg-status-warning",
        )}
      />
      {label}
      {timeLabel && !isOffline && (
        <span className="text-text-muted font-normal">· {timeLabel}</span>
      )}
    </span>
  );
}

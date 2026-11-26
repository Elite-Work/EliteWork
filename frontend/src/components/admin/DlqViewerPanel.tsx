"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { adminApi, AdminApiError, type DlqEventSummary } from "@/lib/api/admin";
import { Button } from "@/components/ui/Button";

const DLQ_QUEUES = [
  { value: "webhooks", label: "Webhooks" },
  { value: "notifications", label: "Notifications" },
  { value: "exports", label: "Exports" },
  { value: "trade-expiry", label: "Trade Expiry" },
  { value: "reconciliation", label: "Reconciliation" },
] as const;

const DEFAULT_LIMIT = 25;

function truncateHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString();
}

export interface DlqViewerPanelProps {
  initialQueue?: string;
  limit?: number;
}

export function DlqViewerPanel({
  initialQueue = "webhooks",
  limit = DEFAULT_LIMIT,
}: DlqViewerPanelProps) {
  const { token, isAuthenticated } = useAuth();
  const [queue, setQueue] = useState<string>(initialQueue);
  const [events, setEvents] = useState<DlqEventSummary[]>([]);
  const [depth, setDepth] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingIds, setRetryingIds] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const loadEvents = useCallback(async () => {
    if (!isAuthenticated || !token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await adminApi.dlq.list(token, { queue, page: 1, limit });
      setEvents(response.events);
      setDepth(response.depth);
    } catch (err) {
      const message =
        err instanceof AdminApiError || err instanceof Error
          ? err.message
          : "Failed to load dead-letter events";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, token, queue, limit]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const handleRetry = useCallback(
    async (event: DlqEventSummary) => {
      if (!token) return;

      setRetryingIds((prev) => ({ ...prev, [event.eventId]: true }));
      setFeedback(null);

      try {
        await adminApi.dlq.replay(token, event.queue || queue, event.eventId);
        setEvents((prev) => prev.filter((item) => item.eventId !== event.eventId));
        setDepth((prev) => Math.max(0, prev - 1));
        setFeedback({
          type: "success",
          message: `Re-enqueued event ${event.eventId} for retry.`,
        });
      } catch (err) {
        const message =
          err instanceof AdminApiError || err instanceof Error
            ? err.message
            : "Failed to retry dead-letter event";
        setFeedback({
          type: "error",
          message: `Retry failed for event ${event.eventId}: ${message}`,
        });
      } finally {
        setRetryingIds((prev) => {
          const next = { ...prev };
          delete next[event.eventId];
          return next;
        });
      }
    },
    [token, queue],
  );

  return (
    <section
      data-testid="dlq-viewer-panel"
      aria-labelledby="dlq-viewer-heading"
      className="rounded-xl border border-border-default bg-bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-default px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 id="dlq-viewer-heading" className="text-lg font-semibold text-text-primary">
            Dead-Letter Queue
          </h2>
          <span
            data-testid="dlq-depth-badge"
            className="inline-flex items-center rounded-full bg-status-danger/15 px-2.5 py-0.5 text-xs font-semibold text-status-danger"
          >
            {depth} failed
          </span>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="dlq-queue-select" className="sr-only">
            Select queue
          </label>
          <select
            id="dlq-queue-select"
            aria-label="Queue"
            value={queue}
            onChange={(e) => {
              setFeedback(null);
              setQueue(e.target.value);
            }}
            className="rounded-md border border-border-default bg-bg-surface px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-gold"
          >
            {DLQ_QUEUES.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
              </option>
            ))}
          </select>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setFeedback(null);
              void loadEvents();
            }}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`border-b border-border-default px-6 py-2.5 text-sm ${
            feedback.type === "success"
              ? "bg-status-success/10 text-status-success"
              : "bg-status-danger/10 text-status-danger"
          }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="p-6">
        {loading ? (
          <div
            data-testid="dlq-loading"
            className="space-y-3"
            aria-busy="true"
            aria-label="Loading dead-letter events"
          >
            <div className="h-12 animate-pulse rounded-lg bg-bg-surface" />
            <div className="h-12 animate-pulse rounded-lg bg-bg-surface" />
            <div className="h-12 animate-pulse rounded-lg bg-bg-surface" />
          </div>
        ) : error ? (
          <div
            role="alert"
            data-testid="dlq-error"
            className="flex flex-col items-start gap-3 rounded-lg border border-status-danger/30 bg-status-danger/10 p-4"
          >
            <p className="text-sm font-medium text-status-danger">{error}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void loadEvents();
              }}
            >
              Try again
            </Button>
          </div>
        ) : events.length === 0 ? (
          <p
            data-testid="dlq-empty"
            className="py-8 text-center text-sm text-text-muted"
          >
            No dead-letter events in the <span className="font-mono">{queue}</span> queue.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border-default text-xs uppercase tracking-wider text-text-muted">
                  <th scope="col" className="pb-3 pr-4 font-semibold">
                    Event ID
                  </th>
                  <th scope="col" className="pb-3 pr-4 font-semibold">
                    Failure Reason
                  </th>
                  <th scope="col" className="pb-3 pr-4 font-semibold">
                    Payload Hash
                  </th>
                  <th scope="col" className="pb-3 pr-4 font-semibold">
                    Retries
                  </th>
                  <th scope="col" className="pb-3 pr-4 font-semibold">
                    Failed At
                  </th>
                  <th scope="col" className="pb-3 text-right font-semibold">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {events.map((event) => {
                  const isRetrying = Boolean(retryingIds[event.eventId]);
                  return (
                    <tr
                      key={event.eventId}
                      data-testid={`dlq-event-row-${event.eventId}`}
                      className="align-top"
                    >
                      <td className="py-3 pr-4 font-mono text-xs text-text-primary">
                        <div>{event.eventId}</div>
                        <div className="text-text-muted">{event.jobName}</div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="font-medium text-status-danger">
                          {event.failureReason}
                        </div>
                        <div className="text-xs text-text-muted">{event.errorClass}</div>
                      </td>
                      <td
                        className="py-3 pr-4 font-mono text-xs text-text-secondary"
                        title={event.payloadHash}
                      >
                        {truncateHash(event.payloadHash)}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-text-primary">
                        {event.retryCount}
                      </td>
                      <td className="py-3 pr-4 text-xs text-text-secondary whitespace-nowrap">
                        {formatTimestamp(event.failedAt)}
                      </td>
                      <td className="py-3 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={isRetrying}
                          aria-label={`Retry event ${event.eventId}`}
                          onClick={() => {
                            void handleRetry(event);
                          }}
                        >
                          {isRetrying ? "Retrying…" : "Retry"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

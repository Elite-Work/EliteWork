"use client";

import { useEffect } from "react";
import { useOffline } from "@/hooks/useOffline";
import { useOfflineQueueStore } from "@/stores/offlineQueueStore";
import { useToast } from "@/hooks/useToast";
import { request } from "@/lib/api/client";

export function ConnectivityBanner() {
  const { isOffline, wasOffline, retryOnline } = useOffline();
  const queue = useOfflineQueueStore((s) => s.queue);
  const replay = useOfflineQueueStore((s) => s.replay);
  const setOnline = useOfflineQueueStore((s) => s.setOnline);
  const { addToast, addToastWithCorrelation } = useToast();

  // Sync online state to queue store
  useEffect(() => {
    setOnline(!isOffline);
  }, [isOffline, setOnline]);

  // Replay on reconnect with conflict handling via idempotency keys
  useEffect(() => {
    if (!isOffline && wasOffline && queue.length > 0) {
      const correlationId = `replay-${Date.now()}`;
      addToastWithCorrelation({
        type: "info",
        title: "Reconnected",
        message: `Replay ${queue.length} queued action(s)…`,
        correlationId,
        duration: 0,
      });

      void replay(async (action) => {
        // Reuse same idempotency key — backend #3 honors key reuse → duplicate-send prevented
        await request(action.endpoint, {
          method: action.method,
          body: action.body ? JSON.stringify(action.body) : undefined,
          headers: {
            "Idempotency-Key": action.idempotencyKey,
            "X-Correlation-Id": action.correlationId,
          },
        });
      }).then(({ succeeded, failed }) => {
        if (failed.length === 0) {
          addToast({ type: "success", title: "Synced", message: `${succeeded.length} queued action(s) sent.` });
        } else {
          addToast({ type: "warning", title: "Partial sync", message: `${succeeded.length} sent, ${failed.length} failed — will retry.` });
        }
        void retryOnline();
      });
    }
  }, [isOffline, wasOffline, queue.length, replay, retryOnline, addToast, addToastWithCorrelation]);

  // Persistent live region: it stays mounted so screen readers announce both
  // offline and back-online transitions, including when no visual banner shows.
  const liveMessage = isOffline
    ? "You are offline. Actions will be queued and sent when reconnected."
    : wasOffline
      ? "Back online."
      : "";
  const liveRegion = (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="connectivity-live-region">
      {liveMessage}
    </div>
  );

  // Accurate banner states during transition windows
  const showOfflineBanner = isOffline;
  const showReconnectBanner = !isOffline && wasOffline && queue.length > 0;

  return (
    <>
      {liveRegion}
      {showOfflineBanner && (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-status-warning text-text-inverse px-4 py-2 text-sm text-center flex items-center justify-center gap-3">
          <span aria-hidden>●</span>
          <span>You’re offline — actions will be queued and sent when reconnected.</span>
          {queue.length > 0 && (
            <span className="bg-white/20 rounded-full px-2 py-0.5 text-xs font-semibold">{queue.length} pending</span>
          )}
          <button
            onClick={() => void retryOnline()}
            className="ml-2 underline hover:no-underline focus-visible:outline-2 focus-visible:outline-white rounded px-1"
            aria-label="Retry connection"
          >
            Retry
          </button>
        </div>
      )}
      {showReconnectBanner && (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-status-info text-white px-4 py-2 text-sm text-center">
          Reconnecting — replaying {queue.length} queued action(s)…
        </div>
      )}
    </>
  );
}

export function PendingBadge() {
  const queue = useOfflineQueueStore((s) => s.queue);
  if (queue.length === 0) return null;
  return (
    <span
      aria-label={`${queue.length} actions pending sync`}
      className="inline-flex items-center gap-1 rounded-full bg-status-warning/20 text-status-warning border border-status-warning/30 px-2 py-1 text-xs font-semibold"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-status-warning animate-pulse" aria-hidden />
      {queue.length} pending
    </span>
  );
}

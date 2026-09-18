"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { api, ApiError, AdminStreamSummary } from "@/lib/api";
import { isForbiddenError } from "@/lib/errorHandler";
import { trackAdminEvent } from "@/lib/analytics";
import { ErrorState } from "@/components/ui/ErrorState";
import { ForbiddenState } from "@/components/ui/ForbiddenState";
import { SkeletonList } from "@/components/ui/SkeletonList";
import { Button } from "@/components/ui/Button";
import { StreamClawbackForm } from "@/components/admin/StreamClawbackForm";
import { VirtualizedList } from "@/components/ui/VirtualizedList";

const PAGE_SIZE = 20;
const STREAM_ROW_HEIGHT = 140;

export default function AdminStreamsPage() {
  const { token, isAuthenticated } = useAuth();
  const isAdmin = useIsAdmin();

  const [streams, setStreams] = useState<AdminStreamSummary[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);

  const fetchStreams = useCallback(async () => {
    if (!isAuthenticated || !token || !isAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setForbidden(false);

    try {
      const response = await api.adminStreams.list(token, { page, limit: PAGE_SIZE });
      setStreams(response.items);
      setTotalPages(response.pagination.totalPages);
      trackAdminEvent("admin_streams_page_view", "success", { page });
    } catch (err) {
      if (err instanceof ApiError && isForbiddenError(err)) {
        setForbidden(true);
        trackAdminEvent("admin_streams_page_view", "failed", { reason: "forbidden" });
      } else {
        const errorMessage =
          err instanceof Error ? err.message : "Unable to reach the server. Check your connection and try again.";
        setError(errorMessage);
        trackAdminEvent("admin_streams_page_view", "failed", { reason: "error" });
      }
    } finally {
      setLoading(false);
    }
  }, [token, isAuthenticated, isAdmin, page]);

  useEffect(() => {
    trackAdminEvent("admin_streams_page_view", "viewed");
  }, []);

  // Fetch on mount / when page or auth changes; setState happens inside
  // fetchStreams's async body, not synchronously in the effect.
  useEffect(() => {
    fetchStreams();
  }, [fetchStreams]);

  const handleClawbackSuccess = useCallback(() => {
    setActiveStreamId(null);
    fetchStreams();
  }, [fetchStreams]);

  if (!isAdmin) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="admin-streams-page">
        <ForbiddenState />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="admin-streams-page">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-text-primary">Stream Admin</h1>
        </div>
        <SkeletonList rows={PAGE_SIZE} />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="admin-streams-page">
        <ForbiddenState />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="admin-streams-page">
        <ErrorState
          variant="card"
          title="Couldn't load streams"
          message={error}
          onRetry={fetchStreams}
        />
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="admin-streams-page">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-text-primary">Stream Admin</h1>
      </div>

      <VirtualizedList
        items={streams}
        rowHeight={STREAM_ROW_HEIGHT}
        maxHeight={Math.min(streams.length * STREAM_ROW_HEIGHT, 600)}
        keyExtractor={(stream) => stream.streamId}
        isEmpty={streams.length === 0}
        emptyState={
          <div className="text-center py-12 text-text-secondary">No streams to display</div>
        }
        renderItem={(stream) => {
          const isActionable = BigInt(stream.unclaimed || "0") > BigInt(0);
          const isOpen = activeStreamId === stream.streamId;

          return (
            <div
              className="p-6 bg-bg-elevated rounded-lg border border-border-default mb-4"
              data-testid={`stream-row-${stream.streamId}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-mono text-sm text-text-primary">{stream.streamId}</span>
                    <span className="text-xs uppercase tracking-wide text-text-secondary">
                      {stream.status}
                    </span>
                  </div>
                  <div className="text-sm text-text-secondary mb-1">
                    Recipient: {stream.recipient}
                  </div>
                  <div className="text-sm text-text-secondary">
                    Remaining vested: <span className="font-mono text-text-primary">{stream.unclaimed}</span>
                    {" · "}
                    Vesting state: {stream.vestingState}
                  </div>
                </div>
                <div>
                  {isActionable && token ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setActiveStreamId(isOpen ? null : stream.streamId)}
                    >
                      {isOpen ? "Cancel" : "Clawback"}
                    </Button>
                  ) : (
                    <span className="text-xs text-text-secondary">No clawback available</span>
                  )}
                </div>
              </div>

              {isOpen && token && (
                <div className="mt-4 pt-4 border-t border-border-default">
                  <StreamClawbackForm
                    token={token}
                    streamId={stream.streamId}
                    remainingVested={stream.unclaimed}
                    onSuccess={handleClawbackSuccess}
                  />
                </div>
              )}
            </div>
          );
        }}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-8">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <span className="px-3 py-1 text-sm text-text-secondary">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

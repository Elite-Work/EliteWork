"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { api, ApiError, AdminAuditEntry } from "@/lib/api";
import { isForbiddenError } from "@/lib/errorHandler";
import { trackAdminEvent } from "@/lib/analytics";
import { generateBreadcrumbs } from "@/lib/breadcrumbs";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { ErrorState } from "@/components/ui/ErrorState";
import { ForbiddenState } from "@/components/ui/ForbiddenState";
import { SkeletonList } from "@/components/ui/SkeletonList";
import { Button } from "@/components/ui/Button";
import { VirtualizedList } from "@/components/ui/VirtualizedList";

const PAGE_SIZE = 20;
const AUDIT_ROW_HEIGHT = 120;

// ─── Sorting ────────────────────────────────────────────────────────────────

type SortKey = "createdAt" | "actorAddress" | "action";
type SortDirection = "asc" | "desc";

interface SortState {
  key: SortKey;
  direction: SortDirection;
}

const SORT_COLUMNS: {
  key: SortKey;
  label: string;
  /** Fraction of the row width the header column occupies. */
  className: string;
}[] = [
  { key: "action", label: "Action type", className: "flex-1" },
  { key: "actorAddress", label: "Actor", className: "flex-1" },
  { key: "createdAt", label: "Date", className: "w-44 shrink-0" },
];

/** Newest-first is the useful default for an audit trail. */
const DEFAULT_SORT: SortState = { key: "createdAt", direction: "desc" };

function toggleSort(current: SortState, key: SortKey): SortState {
  if (current.key !== key) {
    // Text columns read naturally ascending; dates are most useful newest-first.
    return { key, direction: key === "createdAt" ? "desc" : "asc" };
  }
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

function timeValue(entry: AdminAuditEntry): number {
  const parsed = Date.parse(entry.createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Stable, locale-aware comparator. Numeric ids break ties so equal values keep
 * a deterministic order across re-sorts.
 */
function compareEntries(a: AdminAuditEntry, b: AdminAuditEntry, key: SortKey): number {
  switch (key) {
    case "createdAt":
      return timeValue(a) - timeValue(b) || a.id - b.id;
    case "actorAddress":
      return a.actorAddress.localeCompare(b.actorAddress) || a.id - b.id;
    case "action":
      return a.action.localeCompare(b.action) || a.id - b.id;
  }
}

function sortEntries(entries: AdminAuditEntry[], sort: SortState): AdminAuditEntry[] {
  const factor = sort.direction === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => factor * compareEntries(a, b, sort.key));
}

function SortArrow({ direction }: { direction: SortDirection }) {
  return (
    <svg
      aria-hidden="true"
      className={`w-3 h-3 shrink-0 transition-transform ${
        direction === "asc" ? "rotate-180" : ""
      }`}
      viewBox="0 0 12 12"
      fill="currentColor"
    >
      <path d="M6 8.5 2.5 5h7z" />
    </svg>
  );
}

function SortHeader({
  columnKey,
  label,
  sort,
  onSort,
  className,
}: {
  columnKey: SortKey;
  label: string;
  sort: SortState;
  onSort: (key: SortKey) => void;
  className: string;
}) {
  const isActive = sort.key === columnKey;
  return (
    <div
      role="columnheader"
      aria-sort={isActive ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className={`${className} flex items-center gap-1.5 px-6 py-2`}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        aria-label={`Sort by ${label}${
          isActive ? (sort.direction === "asc" ? ", currently ascending" : ", currently descending") : ""
        }`}
        className={`flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${
          isActive
            ? "text-gold hover:bg-gold-muted"
            : "text-text-muted hover:text-text-secondary hover:bg-bg-elevated"
        }`}
      >
        {label}
        {isActive && <SortArrow direction={sort.direction} />}
      </button>
    </div>
  );
}

// ─── Formatting ─────────────────────────────────────────────────────────────

function formatTimestamp(dateString: string): string {
  return new Date(dateString).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAction(action: string): string {
  return action
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function truncateAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AdminAuditHistoryPage() {
  const { token, isAuthenticated } = useAuth();
  const isAdmin = useIsAdmin();
  const pathname = usePathname();
  const breadcrumbs = generateBreadcrumbs(pathname ?? "/admin/audit");

  const [entries, setEntries] = useState<AdminAuditEntry[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  const fetchAuditHistory = useCallback(async () => {
    if (!isAuthenticated || !token || !isAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setForbidden(false);

    try {
      const response = await api.adminAudit.list(token, { page, limit: PAGE_SIZE });
      setEntries(response.items);
      setTotalPages(response.pagination.totalPages);
      trackAdminEvent("admin_audit_page_view", "success", { page });
    } catch (err) {
      if (err instanceof ApiError && isForbiddenError(err)) {
        setForbidden(true);
        trackAdminEvent("admin_audit_page_view", "failed", { reason: "forbidden" });
      } else {
        const errorMessage =
          err instanceof Error ? err.message : "Unable to reach the server. Check your connection and try again.";
        setError(errorMessage);
        trackAdminEvent("admin_audit_page_view", "failed", { reason: "error" });
      }
    } finally {
      setLoading(false);
    }
  }, [token, isAuthenticated, isAdmin, page]);

  useEffect(() => {
    trackAdminEvent("admin_audit_page_view", "viewed");
  }, []);

  useEffect(() => {
    fetchAuditHistory();
  }, [fetchAuditHistory]);

  const handleSort = useCallback((key: SortKey) => {
    setSort((current) => {
      const next = toggleSort(current, key);
      trackAdminEvent("admin_audit_sort", "success", {
        sortBy: next.key,
        sortDirection: next.direction,
      });
      return next;
    });
  }, []);

  const sortedEntries = useMemo(() => sortEntries(entries, sort), [entries, sort]);

  const activeSortLabel = useMemo(() => {
    const column = SORT_COLUMNS.find((c) => c.key === sort.key);
    return `${column?.label ?? sort.key} ${sort.direction === "asc" ? "ascending" : "descending"}`;
  }, [sort]);

  if (!isAdmin) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="admin-audit-page">
        <ForbiddenState />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="admin-audit-page">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-text-primary">Admin Action History</h1>
        </div>
        <SkeletonList rows={PAGE_SIZE} />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="admin-audit-page">
        <ForbiddenState />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="admin-audit-page">
        <ErrorState
          variant="card"
          title="Couldn't load admin action history"
          message={error}
          onRetry={fetchAuditHistory}
        />
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto" data-testid="admin-audit-page">
      <Breadcrumbs items={breadcrumbs} className="mb-3" />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-text-primary">Admin Action History</h1>
      </div>

      {entries.length > 0 && (
        <div
          role="row"
          aria-label="Sort admin actions"
          className="flex items-center rounded-t-lg border border-b-0 border-border-default bg-bg-elevated text-left"
        >
          {SORT_COLUMNS.map((column) => (
            <SortHeader
              key={column.key}
              columnKey={column.key}
              label={column.label}
              sort={sort}
              onSort={handleSort}
              className={column.className}
            />
          ))}
        </div>
      )}

      <VirtualizedList
        items={sortedEntries}
        rowHeight={AUDIT_ROW_HEIGHT}
        maxHeight={Math.min(sortedEntries.length * AUDIT_ROW_HEIGHT, 600)}
        className={entries.length > 0 ? "rounded-b-lg" : undefined}
        keyExtractor={(entry) => String(entry.id)}
        isEmpty={sortedEntries.length === 0}
        emptyState={
          <div className="text-center py-12 text-text-secondary">No admin actions recorded yet</div>
        }
        renderItem={(entry) => (
          <div className="p-6 bg-bg-card rounded-lg border border-border-default mb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-lg font-semibold text-text-primary" data-testid="audit-action">
                    {formatAction(entry.action)}
                  </span>
                </div>
                <div className="text-sm text-text-secondary mb-1" title={entry.actorAddress}>
                  Admin: {truncateAddress(entry.actorAddress)}
                </div>
                {entry.targetReference && (
                  <div className="text-sm text-text-secondary mb-1">
                    Reference: {entry.targetReference}
                  </div>
                )}
                {entry.note && (
                  <div className="text-sm text-text-secondary mb-1">Note: {entry.note}</div>
                )}
              </div>
              <div className="text-sm text-text-secondary whitespace-nowrap">
                {formatTimestamp(entry.createdAt)}
              </div>
            </div>
          </div>
        )}
      />

      {entries.length > 0 && (
        <p className="mt-3 text-xs text-text-muted" data-testid="audit-sort-status">
          Showing {sortedEntries.length} {sortedEntries.length === 1 ? "entry" : "entries"} sorted by{" "}
          {activeSortLabel}
        </p>
      )}

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

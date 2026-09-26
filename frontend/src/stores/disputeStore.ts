import { create } from "zustand";
import { disputesApi } from "@/lib/api/disputes";
import type { DisputeResponse, DisputeStatus } from "@/lib/api/types";
import { getCorrelationId, shouldDedup, registerAction } from "@/lib/actionDedup";
import { generateIdempotencyKey } from "@/lib/idempotency";

export interface DisputeFilters {
  status?: string;
}

export interface DisputeState {
  disputes: DisputeResponse[];
  total: number;
  page: number;
  filters: DisputeFilters;
  isLoading: boolean;
  error: string | null;
  // Optimistic tracking mirroring tradeStore pattern
  pendingActions: Record<string, { correlationId: string; idempotencyKey: string; action: string }>;
  fetchDisputes: (token: string, params?: { status?: string; page?: number; limit?: number }) => Promise<void>;
  setPage: (page: number, token: string) => Promise<void>;
  setFilter: (filters: DisputeFilters, token: string) => Promise<void>;
  /** Snapshot-based optimistic dispute resolution update */
  resolveDisputeOptimistic: (
    tradeId: string,
    action: "accept" | "reject" | "50/50" | "70/30" | string,
    serverFn: () => Promise<void>,
    opts?: { correlationId?: string; idempotencyKey?: string },
  ) => Promise<{ correlationId: string; idempotencyKey: string }>;
  acceptDispute: (
    tradeId: string,
    serverFn: () => Promise<void>,
    opts?: { correlationId?: string; idempotencyKey?: string },
  ) => Promise<{ correlationId: string; idempotencyKey: string }>;
  rejectDispute: (
    tradeId: string,
    serverFn: () => Promise<void>,
    opts?: { correlationId?: string; idempotencyKey?: string },
  ) => Promise<{ correlationId: string; idempotencyKey: string }>;
  withDedup: <T>(actionKey: string, fn: (ids: { correlationId: string; idempotencyKey: string }) => Promise<T>) => Promise<T | null>;
}

export const useDisputeStore = create<DisputeState>((set, get) => ({
  disputes: [],
  total: 0,
  page: 1,
  filters: {},
  isLoading: false,
  error: null,
  pendingActions: {},

  fetchDisputes: async (token, params) => {
    set({ isLoading: true, error: null });
    try {
      const { page, filters } = get();
      const statusParam = params?.status ?? filters.status;
      const res = await disputesApi.list(token, {
        status: statusParam === "all" ? undefined : statusParam,
        page: params?.page ?? page,
        limit: params?.limit ?? 10,
      });
      set({
        disputes: res.items,
        total: res.pagination?.total ?? res.items.length,
        isLoading: false,
      });
    } catch (e) {
      set({
        error: (e as Error).message ?? "Failed to load disputes",
        isLoading: false,
      });
    }
  },

  setPage: async (page, token) => {
    set({ page });
    await get().fetchDisputes(token, { page });
  },

  setFilter: async (filters, token) => {
    set({ filters, page: 1 });
    await get().fetchDisputes(token, { status: filters.status, page: 1 });
  },

  // --- Optimistic resolution core with snapshot-based rollback (Issue #112) ---
  resolveDisputeOptimistic: async (tradeId, action, serverFn, opts) => {
    const actionKey = `resolve-dispute:${tradeId}:${action}`;
    const dedup = shouldDedup(actionKey);
    if (dedup.dedup) {
      return { correlationId: dedup.entry!.correlationId, idempotencyKey: dedup.entry!.idempotencyKey };
    }

    const correlationId = opts?.correlationId ?? getCorrelationId();
    const idempotencyKey = opts?.idempotencyKey ?? generateIdempotencyKey();
    registerAction(actionKey, correlationId, idempotencyKey);

    // Snapshot for rollback — capture previous disputes array and specific target
    const prevDisputes = get().disputes;
    const prevDispute = prevDisputes.find((d) => d.tradeId === tradeId);
    const snapshot = prevDispute ? { ...prevDispute } : null;

    // Apply optimistic patch: mark status as RESOLVED immediately
    set((s) => ({
      disputes: s.disputes.map((d) =>
        d.tradeId === tradeId ? { ...d, status: "RESOLVED" as DisputeStatus } : d,
      ),
      pendingActions: {
        ...s.pendingActions,
        [actionKey]: { correlationId, idempotencyKey, action },
      },
    }));

    try {
      await serverFn();
      // On success, clear pending action
      set((s) => {
        const next = { ...s.pendingActions };
        delete next[actionKey];
        return { pendingActions: next };
      });
    } catch (err) {
      // Failure mid-flight: restore exact prior state (snapshot-based rollback)
      set((s) => {
        const restored = snapshot
          ? s.disputes.map((d) => (d.tradeId === tradeId ? snapshot : d))
          : prevDisputes;
        const nextPending = { ...s.pendingActions };
        delete nextPending[actionKey];
        return { disputes: restored, pendingActions: nextPending };
      });
      throw err;
    }

    return { correlationId, idempotencyKey };
  },

  acceptDispute: async (tradeId, serverFn, opts) => {
    return get().resolveDisputeOptimistic(tradeId, "accept", serverFn, opts);
  },

  rejectDispute: async (tradeId, serverFn, opts) => {
    return get().resolveDisputeOptimistic(tradeId, "reject", serverFn, opts);
  },

  withDedup: async (actionKey, fn) => {
    const dedup = shouldDedup(actionKey);
    if (dedup.dedup) return null;
    const correlationId = getCorrelationId();
    const idempotencyKey = generateIdempotencyKey();
    registerAction(actionKey, correlationId, idempotencyKey);
    return fn({ correlationId, idempotencyKey });
  },
}));

import { create } from "zustand";
import { tradesApi } from "@/lib/api/trades";
import type { TradeResponse } from "@/lib/api/types";
import { getCorrelationId, shouldDedup, registerAction } from "@/lib/actionDedup";
import { generateIdempotencyKey } from "@/lib/idempotency";

interface Filters {
  status?: string;
}

interface TradeState {
  trades: TradeResponse[];
  total: number;
  page: number;
  filters: Filters;
  isLoading: boolean;
  error: string | null;
  // Optimistic helpers
  pendingActions: Record<string, { correlationId: string; idempotencyKey: string }>;
  fetchTrades: (token: string) => Promise<void>;
  setPage: (page: number, token: string) => Promise<void>;
  setFilter: (filters: Filters, token: string) => Promise<void>;
  addTrade: (trade: TradeResponse) => void;
  updateTrade: (tradeId: string, patch: Partial<TradeResponse>, serverFn?: () => Promise<void>) => Promise<void>;
  removeTrade: (tradeId: string, serverFn?: () => Promise<void>) => Promise<void>;
  /** Optimistic update with explicit correlation/idempotency — returns correlationId for toast contract */
  updateTradeOptimistic: (
    tradeId: string,
    patch: Partial<TradeResponse>,
    serverFn: () => Promise<void>,
    opts?: { correlationId?: string; idempotencyKey?: string },
  ) => Promise<{ correlationId: string; idempotencyKey: string }>;
  /** Optimistic dispute resolution actions (Issue #112) */
  resolveDisputeOptimistic: (
    tradeId: string,
    action: "accept" | "reject" | string,
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
  /** Unified dedup wrapper for any trade mutation — prevents double-submit window */
  withDedup: <T>(actionKey: string, fn: (ids: { correlationId: string; idempotencyKey: string }) => Promise<T>) => Promise<T | null>;
}

export const useTradeStore = create<TradeState>((set, get) => ({
  trades: [],
  total: 0,
  page: 1,
  filters: {},
  isLoading: false,
  error: null,
  pendingActions: {},

  fetchTrades: async (token) => {
    set({ isLoading: true, error: null });
    try {
      const { page, filters } = get();
      const res = await tradesApi.list(token, { status: filters.status, page });
      set({ trades: res.items, total: res.pagination.total, isLoading: false });
    } catch (e) {
      set({ error: (e as Error).message ?? "Failed to load trades", isLoading: false });
    }
  },

  setPage: async (page, token) => {
    set({ page });
    await get().fetchTrades(token);
  },

  setFilter: async (filters, token) => {
    set({ filters, page: 1 });
    await get().fetchTrades(token);
  },

  addTrade: (trade) => {
    set((s) => ({ trades: [trade, ...s.trades], total: s.total + 1 }));
  },

  // --- Optimistic core with snapshot-based rollback ---
  updateTrade: async (tradeId, patch, serverFn) => {
    // De-duplication: prevent rapid double-submit for same trade+patch
    const actionKey = `update:${tradeId}:${JSON.stringify(patch)}`;
    const dedup = shouldDedup(actionKey);
    if (dedup.dedup) return;

    const correlationId = getCorrelationId();
    const idempotencyKey = generateIdempotencyKey();
    registerAction(actionKey, correlationId, idempotencyKey);

    // Snapshot for rollback — deep clone relevant slice
    const prevTrades = get().trades;
    const prevTrade = prevTrades.find((t) => t.tradeId === tradeId);
    const snapshot = prevTrade ? { ...prevTrade } : null;

    // Apply optimistic patch
    set((s) => ({
      trades: s.trades.map((t) => (t.tradeId === tradeId ? { ...t, ...patch } : t)),
      pendingActions: { ...s.pendingActions, [actionKey]: { correlationId, idempotencyKey } },
    }));

    if (serverFn) {
      try {
        await serverFn();
        // Success — clear pending
        set((s) => {
          const next = { ...s.pendingActions };
          delete next[actionKey];
          return { pendingActions: next };
        });
      } catch (err) {
        // Failure-mid-flight: restore exact prior state (snapshot-based rollback)
        set((s) => {
          const restored = snapshot
            ? s.trades.map((t) => (t.tradeId === tradeId ? snapshot : t))
            : s.trades; // if trade didn't exist, keep as-is (or revert to prevTrades for full fidelity)
          // Full fidelity fallback: if we have prevTrades snapshot, use it for total correctness
          const nextPending = { ...s.pendingActions };
          delete nextPending[actionKey];
          // Determine if patch introduced new trade artifact; safest is to restore prevTrades if snapshot missing
          const finalTrades = snapshot ? restored : prevTrades;
          return { trades: finalTrades, pendingActions: nextPending };
        });
        throw err;
      }
    } else {
      // No serverFn — just clear pending after tick (optimistic local update)
      set((s) => {
        const next = { ...s.pendingActions };
        delete next[actionKey];
        return { pendingActions: next };
      });
    }
  },

  updateTradeOptimistic: async (tradeId, patch, serverFn, opts) => {
    const correlationId = opts?.correlationId ?? getCorrelationId();
    const idempotencyKey = opts?.idempotencyKey ?? generateIdempotencyKey();
    const actionKey = `update:${tradeId}:${JSON.stringify(patch)}`;
    const dedup = shouldDedup(actionKey);
    if (dedup.dedup) {
      return { correlationId: dedup.entry!.correlationId, idempotencyKey: dedup.entry!.idempotencyKey };
    }
    registerAction(actionKey, correlationId, idempotencyKey);

    const prevTrades = get().trades;
    const prevTrade = prevTrades.find((t) => t.tradeId === tradeId);
    const snapshot = prevTrade ? { ...prevTrade } : null;

    set((s) => ({
      trades: s.trades.map((t) => (t.tradeId === tradeId ? { ...t, ...patch } : t)),
      pendingActions: { ...s.pendingActions, [actionKey]: { correlationId, idempotencyKey } },
    }));

    try {
      await serverFn();
      set((s) => {
        const next = { ...s.pendingActions };
        delete next[actionKey];
        return { pendingActions: next };
      });
    } catch (err) {
      set((s) => {
        const restored = snapshot ? s.trades.map((t) => (t.tradeId === tradeId ? snapshot : t)) : prevTrades;
        const next = { ...s.pendingActions };
        delete next[actionKey];
        return { trades: restored, pendingActions: next };
      });
      throw err;
    }
    return { correlationId, idempotencyKey };
  },

  removeTrade: async (tradeId, serverFn) => {
    const actionKey = `remove:${tradeId}`;
    const dedup = shouldDedup(actionKey);
    if (dedup.dedup) return;
    const correlationId = getCorrelationId();
    const idempotencyKey = generateIdempotencyKey();
    registerAction(actionKey, correlationId, idempotencyKey);

    const prevTrades = get().trades;
    const prevTotal = get().total;
    set((s) => ({
      trades: s.trades.filter((t) => t.tradeId !== tradeId),
      total: s.total - 1,
      pendingActions: { ...s.pendingActions, [actionKey]: { correlationId, idempotencyKey } },
    }));
    if (serverFn) {
      try {
        await serverFn();
        set((s) => {
          const next = { ...s.pendingActions };
          delete next[actionKey];
          return { pendingActions: next };
        });
      } catch (err) {
        set({ trades: prevTrades, total: prevTotal, pendingActions: (() => { const n = { ...get().pendingActions }; delete n[actionKey]; return n; })() });
        throw err;
      }
    } else {
      set((s) => {
        const n = { ...s.pendingActions };
        delete n[actionKey];
        return { pendingActions: n };
      });
    }
  },

  resolveDisputeOptimistic: async (tradeId, action, serverFn, opts) => {
    return get().updateTradeOptimistic(tradeId, { status: "SETTLED" }, serverFn, opts);
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
    try {
      const result = await fn({ correlationId, idempotencyKey });
      return result;
    } catch (e) {
      throw e;
    }
  },
}));

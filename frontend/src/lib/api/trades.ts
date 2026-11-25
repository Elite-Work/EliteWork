import { ApiError, createQueryString, request, resolveApiUrl, withIdempotency } from "./client";
import type {
  BulkCreateResponse,
  CreateTradeRequest,
  CreateTradeResponse,
  DepositResponse,
  EvidenceResponse,
  SubmitManifestRequest,
  SubmitManifestResponse,
  TradeHistoryResponse,
  TradeListResponse,
  TradeResponse,
  TradeStatsResponse,
} from "./types";

export const tradesApi = {
  /**
   * `q` is the free-text search query (#504) matched against commodity and
   * counterparty name by the backend's Supabase full-text index.
   *
   * `cursor` opts into cursor pagination (#502): pass the previous page's
   * `pageInfo.nextCursor` and read `pageInfo.nextCursor` back for the next
   * one. `page` remains only for legacy callers and is deprecated.
   */
  list: (
    token: string,
    params?: { status?: string; page?: number; limit?: number; q?: string; cursor?: string },
  ) =>
    request<TradeListResponse>(
      `/trades${createQueryString({
        status: params?.status,
        page: params?.page,
        limit: params?.limit,
        q: params?.q,
        cursor: params?.cursor,
      })}`,
      { token },
    ),

  /**
   * Downloads the trade receipt PDF (#500). The regular `request` helper
   * parses JSON, so this reads the response as a Blob for the browser to save.
   */
  downloadReceipt: async (token: string, id: string): Promise<Blob> => {
    const response = await fetch(resolveApiUrl(`/trades/${id}/receipt`), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new ApiError(
        response.status,
        (data as { error?: string })?.error || response.statusText,
        data,
      );
    }

    return response.blob();
  },

  get: (token: string, id: string) =>
    request<TradeResponse>(`/trades/${id}`, { token }),

  getHistory: (token: string, id: string) =>
    request<TradeHistoryResponse>(`/trades/${id}/history`, { token }),

  getEvidence: (token: string, id: string) =>
    request<EvidenceResponse>(`/trades/${id}/evidence`, { token }),

  submitManifest: (token: string, tradeId: string, data: SubmitManifestRequest) =>
    request<SubmitManifestResponse>(`/trades/${tradeId}/manifest`, {
      method: "POST",
      token,
      body: JSON.stringify(data),
    }),

  getStats: (token: string) =>
    request<TradeStatsResponse>("/trades/stats", { token }),

  create: (token: string, data: CreateTradeRequest, opts?: { idempotencyKey?: string; correlationId?: string }) =>
    request<CreateTradeResponse>("/trades", {
      method: "POST",
      token,
      headers: withIdempotency(undefined, opts),
      body: JSON.stringify(data),
    }),

  deposit: (token: string, tradeId: string, opts?: { idempotencyKey?: string; correlationId?: string }) =>
    request<DepositResponse>(`/trades/${tradeId}/deposit`, {
      method: "POST",
      token,
      headers: withIdempotency(undefined, opts),
    }),

  confirmDelivery: (token: string, tradeId: string, opts?: { idempotencyKey?: string; correlationId?: string }) =>
    request<{ unsignedXdr: string }>(`/trades/${tradeId}/confirm`, {
      method: "POST",
      token,
      headers: withIdempotency(undefined, opts),
    }),

  releaseFunds: (token: string, tradeId: string, opts?: { idempotencyKey?: string; correlationId?: string }) =>
    request<{ unsignedXdr: string }>(`/trades/${tradeId}/release`, {
      method: "POST",
      token,
      headers: withIdempotency(undefined, opts),
    }),

  initiateDispute: (token: string, tradeId: string, reason: string, category: string, opts?: { idempotencyKey?: string; correlationId?: string }) =>
    request<{ unsignedXdr: string }>(`/trades/${tradeId}/dispute`, {
      method: "POST",
      token,
      headers: withIdempotency(undefined, opts),
      body: JSON.stringify({ reason, category }),
    }),

  /**
   * Bulk creation for cooperative onboarding (issue #45). Same auth as the
   * single-trade endpoint; the backend reports per-row results so the UI can
   * retry just the failed rows.
   */
  bulkCreate: (
    token: string,
    data: { trades: CreateTradeRequest[] },
    opts?: { idempotencyKey?: string; correlationId?: string },
  ) =>
    request<BulkCreateResponse>("/trades/bulk", {
      method: "POST",
      token,
      headers: withIdempotency(undefined, opts),
      body: JSON.stringify(data),
    }),
};

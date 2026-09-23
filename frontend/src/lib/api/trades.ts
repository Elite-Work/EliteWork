import { createQueryString, request, withIdempotency } from "./client";
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
  list: (token: string, params?: { status?: string; page?: number; limit?: number }) =>
    request<TradeListResponse>(
      `/trades${createQueryString({
        status: params?.status,
        page: params?.page,
        limit: params?.limit,
      })}`,
      { token },
    ),

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

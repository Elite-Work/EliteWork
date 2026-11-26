/**
 * Guarded client helpers for the protected `/admin` routes (#22).
 *
 * Every admin call goes through here rather than being hand-rolled at the call
 * site, so three things stay consistent across web and mobile:
 *
 *   1. An admin token is required. Calls refuse to leave the client without
 *      one, instead of sending an anonymous request and getting a 401 back.
 *   2. Failures are mapped to `AdminApiError`, which names the failure mode
 *      (`unauthenticated`, `forbidden`, `validation`, `not_found`, `conflict`,
 *      `rate_limited`, `server`, `network`) so callers can branch on the reason
 *      rather than on raw status codes.
 *   3. A caller-supplied correlation ID is forwarded as `x-correlation-id`, so
 *      an admin action can be traced from the UI through to the Soroban call
 *      the backend makes (#21).
 *
 * Usage:
 *
 * ```ts
 * import { adminApi, AdminApiError } from "@/lib/api/admin";
 *
 * try {
 *   const { unsignedXdr } = await adminApi.contract.addMediator(token, {
 *     mediatorAddress: address,
 *   });
 *   await signAndSubmit(unsignedXdr);
 * } catch (error) {
 *   if (error instanceof AdminApiError && error.reason === "forbidden") {
 *     showBanner("This wallet is not a configured admin.");
 *   }
 * }
 * ```
 */

import { ApiError, createQueryString, request, type FetchOptions } from "./client";
import type { AdminAuditListResponse } from "./types";

export type AdminFailureReason =
  | "unauthenticated"
  | "forbidden"
  | "validation"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "server"
  | "network";

/**
 * An admin call that did not succeed, with the failure classified.
 *
 * `correlationId` is echoed by the backend on every response, so it can be
 * shown in an error toast and pasted straight into a log search.
 */
export class AdminApiError extends Error {
  readonly reason: AdminFailureReason;
  readonly status: number;
  readonly correlationId?: string;
  readonly cause?: unknown;

  constructor(
    reason: AdminFailureReason,
    message: string,
    status: number,
    options?: { correlationId?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "AdminApiError";
    this.reason = reason;
    this.status = status;
    this.correlationId = options?.correlationId;
    this.cause = options?.cause;
  }
}

const REASON_BY_STATUS: Record<number, AdminFailureReason> = {
  400: "validation",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "validation",
  429: "rate_limited",
};

function reasonForStatus(status: number): AdminFailureReason {
  if (status === 0) return "network";
  return REASON_BY_STATUS[status] ?? (status >= 500 ? "server" : "validation");
}

/** Pull the most useful message the backend offered, whatever shape it used. */
function messageFrom(error: ApiError): string {
  const data = error.data;
  if (data && typeof data === "object") {
    const body = data as { error?: unknown; message?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
    if (typeof body.message === "string" && body.message) return body.message;
  }
  return error.message || "Admin request failed";
}

function correlationIdFrom(error: ApiError): string | undefined {
  const data = error.data;
  if (data && typeof data === "object") {
    const body = data as { correlationId?: unknown };
    if (typeof body.correlationId === "string") return body.correlationId;
  }
  return undefined;
}

export interface AdminRequestOptions {
  /** Forwarded as `x-correlation-id` so the action is traceable end to end. */
  correlationId?: string;
  signal?: AbortSignal;
}

/**
 * Run an admin request with the token enforced and errors mapped.
 *
 * Exported so new admin endpoints can be added without duplicating the guard.
 */
export async function adminRequest<T>(
  endpoint: string,
  token: string,
  options: FetchOptions & AdminRequestOptions = {},
): Promise<T> {
  const { correlationId, signal, ...fetchOptions } = options;

  if (typeof token !== "string" || token.trim() === "") {
    throw new AdminApiError(
      "unauthenticated",
      "An admin token is required for admin API calls",
      401,
    );
  }

  const headers: Record<string, string> = {
    ...(fetchOptions.headers as Record<string, string> | undefined),
  };
  if (correlationId) {
    headers["x-correlation-id"] = correlationId;
  }

  try {
    return await request<T>(endpoint, {
      ...fetchOptions,
      ...(signal ? { signal } : {}),
      headers,
      token,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw new AdminApiError(
        reasonForStatus(error.status),
        messageFrom(error),
        error.status,
        { correlationId: correlationIdFrom(error) ?? correlationId, cause: error },
      );
    }
    throw new AdminApiError(
      "network",
      error instanceof Error ? error.message : "Unknown error",
      0,
      { correlationId, cause: error },
    );
  }
}

export interface UnsignedTxResponse {
  unsignedXdr: string;
}

export interface AdminFeatureFlag {
  enabled: boolean;
  rolloutPercentage?: number;
}

export interface AdminFeatureListResponse {
  flags: AdminFeatureFlag[];
}

export interface AdminBatchStatusUpdate {
  tradeId: string;
  status: string;
}

export interface AdminBatchStatusResponse {
  succeeded: string[];
  failed: { tradeId: string; reason: string }[];
}

export interface AdminAuthClaims {
  walletAddress: string;
  tokenId: string;
  issuedAt: string | null;
  expiresAt: string | null;
  issuer: string | null;
  audience: string | null;
}

export interface DlqEventSummary {
  eventId: string;
  queue: string;
  jobName: string;
  payloadHash: string;
  failureReason: string;
  errorClass: string;
  retryCount: number;
  failedAt: string;
}

export interface AdminDlqListResponse {
  queue: string;
  depth: number;
  page: number;
  limit: number;
  events: DlqEventSummary[];
}

export interface AdminDlqReplayResponse {
  success: boolean;
  queue: string;
  replayedJobId: string;
}

export const adminApi = {
  /** Soroban-backed contract maintenance. Each call returns an unsigned XDR. */
  contract: {
    addMediator: (
      token: string,
      body: { mediatorAddress: string },
      options?: AdminRequestOptions,
    ) =>
      adminRequest<UnsignedTxResponse>("/admin/contract/mediators", token, {
        ...options,
        method: "POST",
        body: JSON.stringify(body),
      }),

    removeMediator: (token: string, mediatorAddress: string, options?: AdminRequestOptions) =>
      adminRequest<UnsignedTxResponse>(
        `/admin/contract/mediators/${encodeURIComponent(mediatorAddress)}`,
        token,
        { ...options, method: "DELETE" },
      ),

    updateFeeBps: (token: string, body: { feeBps: number }, options?: AdminRequestOptions) =>
      adminRequest<UnsignedTxResponse>("/admin/contract/fee", token, {
        ...options,
        method: "PATCH",
        body: JSON.stringify(body),
      }),
  },

  trades: {
    batchStatus: (
      token: string,
      body: { updates: AdminBatchStatusUpdate[] },
      options?: AdminRequestOptions,
    ) =>
      adminRequest<AdminBatchStatusResponse>("/admin/trades/batch/status", token, {
        ...options,
        method: "POST",
        body: JSON.stringify(body),
      }),
  },

  features: {
    list: (token: string, options?: AdminRequestOptions) =>
      adminRequest<AdminFeatureListResponse>("/admin/features", token, options),

    update: (
      token: string,
      name: string,
      body: { enabled: boolean; rolloutPercentage?: number },
      options?: AdminRequestOptions,
    ) =>
      adminRequest<{ name: string; flag: AdminFeatureFlag }>(
        `/admin/features/${encodeURIComponent(name)}`,
        token,
        { ...options, method: "PATCH", body: JSON.stringify(body) },
      ),
  },

  audit: {
    list: (
      token: string,
      params?: { page?: number; limit?: number },
      options?: AdminRequestOptions,
    ) =>
      adminRequest<AdminAuditListResponse>(
        `/admin/audit${createQueryString({ page: params?.page, limit: params?.limit })}`,
        token,
        options,
      ),
  },

  auth: {
    claims: (token: string, options?: AdminRequestOptions) =>
      adminRequest<AdminAuthClaims>("/api/admin/auth/claims", token, options),
  },

  dlq: {
    list: (
      token: string,
      params?: { queue?: string; page?: number; limit?: number },
      options?: AdminRequestOptions,
    ) =>
      adminRequest<AdminDlqListResponse>(
        `/api/admin/dlq${createQueryString({
          queue: params?.queue,
          page: params?.page,
          limit: params?.limit,
        })}`,
        token,
        options,
      ),

    replay: (
      token: string,
      queue: string,
      eventId: string,
      options?: AdminRequestOptions,
    ) =>
      adminRequest<AdminDlqReplayResponse>(
        `/api/admin/dlq/${encodeURIComponent(queue)}/${encodeURIComponent(eventId)}/replay`,
        token,
        { ...options, method: "POST" },
      ),
  },
};

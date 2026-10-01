import { createQueryString, request } from "./client";
import type { DisputeListResponse, DisputeResponse, DisputeStatus } from "./types";

export const disputesApi = {
  list: (token: string, params?: { status?: string; page?: number; limit?: number }) =>
    request<DisputeListResponse>(
      `/disputes${createQueryString({
        status: params?.status,
        page: params?.page,
        limit: params?.limit,
      })}`,
      { token },
    ),
  transition: (token: string, tradeId: string, status: DisputeStatus) =>
    request<DisputeResponse>(`/disputes/${tradeId}/transition`, {
      method: "POST",
      token,
      body: JSON.stringify({ status }),
    }),
};
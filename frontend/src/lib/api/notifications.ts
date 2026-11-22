import { createQueryString, request } from "./client";
import type { NotificationListResponse } from "./types";

export const notificationsApi = {
  list: (token: string, params?: { page?: number; limit?: number }) =>
    request<NotificationListResponse>(
      `/notifications${createQueryString({
        page: params?.page,
        limit: params?.limit,
      })}`,
      { token },
    ),
};

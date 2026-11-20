import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type Notification = components["schemas"]["Notification"];

export interface NotificationList {
  results: Notification[];
  unread_count: number;
}

export const notificationKeys = {
  all: ["notifications"] as const,
};

/** Latest notifications + unread count; polls as a fallback to the websocket push. */
export const notificationsQuery = () =>
  queryOptions({
    queryKey: notificationKeys.all,
    queryFn: async () => (await api.get<NotificationList>("/notifications")).data,
    refetchInterval: 30_000,
  });

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) =>
      api.post<{ marked_read: number; unread_count: number }>("/notifications/read", ids ? { ids } : {}).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

const BASE_URL = import.meta.env.VITE_BASE_BACKEND_URL;

export type SiteNotificationAudience = "ADMIN" | "USER";
export type SiteNotificationSeverity =
  | "INFO"
  | "SUCCESS"
  | "WARNING"
  | "ERROR"
  | "CRITICAL";

export interface SiteNotification {
  notificationId: string;
  audience: SiteNotificationAudience;
  targetUserId?: string | null;
  title: string;
  message: string;
  severity: SiteNotificationSeverity;
  category: string;
  source: string;
  actionUrl?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  read: boolean;
}

export interface NotificationFeed {
  notifications: SiteNotification[];
  unreadCount: number;
}

export interface PublishNotificationPayload {
  audience: SiteNotificationAudience;
  title: string;
  message: string;
  severity: SiteNotificationSeverity;
  category: string;
  targetEmail?: string;
  actionUrl?: string;
  source?: string;
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || body?.detail || "Notification request failed");
  }
  return body.response as T;
}

export const NotificationService = {
  list: (limit = 80) =>
    apiRequest<NotificationFeed>(`/v2/notifications?limit=${limit}`),
  markRead: (notificationId: string) =>
    apiRequest<{ notificationId: string; read: boolean }>(
      `/v2/notifications/${encodeURIComponent(notificationId)}/read`,
      { method: "POST" },
    ),
  markAllRead: () =>
    apiRequest<{ updated: number }>("/v2/notifications/read-all", {
      method: "POST",
    }),
  publish: (payload: PublishNotificationPayload) =>
    apiRequest<SiteNotification>("/v2/notifications", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

import { requestJson } from "../../utils/apiRequest";

const BASE_URL = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");

export type ActivityEventType = "pageview" | "click" | "scroll";

export interface ActivityEvent {
  type: ActivityEventType;
  path: string;
  target?: string;
  scrollDepth?: number;
  ts: string;
}

export interface ActivitySummary {
  hours: number;
  totalEvents: number;
  uniqueUsers: number;
  pageviews: number;
  clicks: number;
  topPages: { path: string; count: number }[];
  topClicks: { path: string; target: string; count: number }[];
  scrollDepth: { depth: number; count: number }[];
  eventsOverTime: { bucket: string; count: number }[];
}

// Fire-and-forget: sendBeacon survives page unload and doesn't hold a
// connection open across the Caddy edge / WireGuard hop, unlike a long-lived
// fetch would. Falls back to a keepalive fetch when sendBeacon is unavailable
// or the payload is rejected (e.g. exceeds the browser's beacon size limit).
export const sendActivityEvents = (sessionId: string, events: ActivityEvent[]): void => {
  if (!events.length) return;
  const url = `${BASE_URL}/v2/activity/events`;
  const body = JSON.stringify({ sessionId, events });
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon(url, blob)) return;
  }
  fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
};

export const sendHeartbeat = (path: string): void => {
  requestJson(`${BASE_URL}/v2/activity/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  }).catch(() => undefined);
};

export const fetchActivitySummary = async (hours: number): Promise<ActivitySummary> => {
  const { body } = await requestJson<{ response: ActivitySummary }>(
    `${BASE_URL}/v2/activity/summary?hours=${hours}`,
  );
  if (!body?.response) throw new Error("Failed to load activity summary");
  return body.response;
};

export const fetchLiveCount = async (): Promise<number> => {
  const { body } = await requestJson<{ response: { liveUsers: number } }>(
    `${BASE_URL}/v2/activity/live-count`,
  );
  return body?.response.liveUsers ?? 0;
};

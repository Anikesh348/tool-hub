import { refreshAccessToken } from "../auth/authSession";

const BASE_URL = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");

export interface UptimeEndpoint {
  key: string;
  name: string;
  group: string;
  healthy: boolean;
  uptimePercent: number;
  averageResponseMs: number;
  lastResponseMs: number;
  lastCheckedAt?: string;
  statusCode?: number;
  errors: string[];
  sampleCount: number;
}

export interface UptimeOverview {
  generatedAt: number;
  endpoints: UptimeEndpoint[];
}

const send = () =>
  fetch(`${BASE_URL}/v2/admin/uptime`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

export const fetchUptimeOverview = async (): Promise<UptimeOverview> => {
  let response = await send();
  if (response.status === 401 && (await refreshAccessToken())) response = await send();
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || body?.detail || "Uptime data is unavailable");
  }
  return (body?.response ?? body) as UptimeOverview;
};

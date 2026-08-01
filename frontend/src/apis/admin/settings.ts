import { refreshAccessToken } from "../auth/authSession";

const BASE_URL = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");

export interface AdminStatus {
  host: {
    available: boolean;
    hostname?: string;
    kernel?: string;
    architecture?: string;
    uptimeSeconds?: number;
    loadAverage?: number[];
    memory?: { totalBytes: number; usedBytes: number };
    disk?: { totalBytes: number; usedBytes: number; freeBytes: number };
  };
  redis: {
    status: "up" | "down";
    keys: number;
    usedMemoryBytes: number;
    maxMemoryBytes: number;
  };
}

export interface AdminAuditItem {
  _id: string;
  email?: string;
  action: string;
  status: string;
  createdAt: string;
  details?: Record<string, unknown>;
}

export interface ServerSpeedTestResult {
  message: string;
  pingMs: number;
  downloadMbps: number;
  uploadMbps: number;
  bytesSent?: number;
  bytesReceived?: number;
  timestamp?: string;
  shareUrl?: string | null;
  server?: {
    id?: string;
    sponsor?: string;
    name?: string;
    country?: string;
    distanceKm?: number;
    latencyMs?: number;
  };
  client?: {
    ip?: string;
    isp?: string;
    country?: string;
  };
}

export interface FleetSpeedTestNodeResult {
  id: string;
  label: string;
  kind: string;
  hostname: string;
  status: "ok" | "error";
  latencyMs?: number;
  jitterMs?: number;
  responseMs?: number;
  downloadMbps?: number;
  uploadMbps?: number;
  durationSeconds: number;
  error?: string;
}

export interface FleetSpeedTestResult {
  available?: boolean;
  message?: string;
  startedAt: string;
  completedAt: string;
  provider: string;
  mode: "sequential" | "individual";
  scope?: "fleet" | "node";
  targetId?: string | null;
  downloadBytesPerHost: number;
  uploadBytesPerHost: number;
  estimatedTotalMiB: number;
  results: FleetSpeedTestNodeResult[];
}

const requestJson = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const send = () => fetch(url, {
    ...(options || {}),
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  let response = await send();
  if (response.status === 401 && (await refreshAccessToken())) response = await send();
  const responseText = await response.text();
  const body = responseText ? (() => { try { return JSON.parse(responseText); } catch { return null; } })() : null;
  if (!response.ok) throw new Error(body?.error || body?.detail || `Admin request failed (${response.status})`);
  return body?.response as T;
};

export const AdminSettingsService = {
  status: () => requestJson<AdminStatus>(`${BASE_URL}/v2/admin/settings/status`),
  audit: () => requestJson<{ items: AdminAuditItem[] }>(`${BASE_URL}/v2/admin/settings/audit`),
  clearCache: () => requestJson<{ message: string; deletedKeys: number }>(`${BASE_URL}/v2/admin/settings/cache/clear`, { method: "POST" }),
  refreshBuzzWatch: () => requestJson<{ message: string; updated: number }>(`${BASE_URL}/v2/admin/settings/buzzwatch/refresh`, { method: "POST" }),
  latestFleetSpeedTest: () => requestJson<FleetSpeedTestResult>(`${BASE_URL}/v2/admin/settings/speedtest`),
  runSpeedTest: (targetId?: string) => requestJson<FleetSpeedTestResult>(
    targetId
      ? `${BASE_URL}/v2/admin/settings/speedtest/${encodeURIComponent(targetId)}`
      : `${BASE_URL}/v2/admin/settings/speedtest`,
    { method: "POST" },
  ),
  restartToolHub: (confirmation: string) => requestJson<{ message: string }>(`${BASE_URL}/v2/admin/settings/restart-toolhub`, {
    method: "POST",
    body: JSON.stringify({ confirmation }),
  }),
  rebootPi: (confirmation: string) => requestJson<{ message: string }>(`${BASE_URL}/v2/admin/settings/reboot`, {
    method: "POST",
    body: JSON.stringify({ confirmation }),
  }),
};

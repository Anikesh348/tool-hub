import { refreshAccessToken } from "../auth/authSession";

const BASE_URL = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");

export interface Pi5RenderState {
  paused: boolean;
  casting: boolean;
  mode: "casting" | "paused" | "live" | "partial";
  blackoutActive: boolean;
  airplayActive: boolean;
  rendererActive: boolean;
  streamActive: boolean;
  message?: string;
}

export interface SmallLightsGuardState {
  enabled: boolean;
}

export interface BigLightsGuardState {
  enabled: boolean;
}

const requestJson = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const send = () => fetch(url, {
    ...(options || {}),
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  let response = await send();
  if (response.status === 401 && (await refreshAccessToken())) response = await send();
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || body?.detail || "Remote action failed");
  return body?.response as T;
};

export const AdminRemoteService = {
  smallLightsGuard: () => requestJson<SmallLightsGuardState>(`${BASE_URL}/v2/admin/home/small-lights-guard`),
  setSmallLightsGuard: (enabled: boolean) => requestJson<SmallLightsGuardState>(
    `${BASE_URL}/v2/admin/home/small-lights-guard/${enabled ? "on" : "off"}`,
    { method: "POST" },
  ),
  bigLightsGuard: () => requestJson<BigLightsGuardState>(`${BASE_URL}/v2/admin/home/big-lights-guard`),
  setBigLightsGuard: (enabled: boolean) => requestJson<BigLightsGuardState>(
    `${BASE_URL}/v2/admin/home/big-lights-guard/${enabled ? "on" : "off"}`,
    { method: "POST" },
  ),
  pi5RenderStatus: () => requestJson<Pi5RenderState>(`${BASE_URL}/v2/admin/remote/pi5-render`),
  setPi5RenderPaused: (paused: boolean) => requestJson<Pi5RenderState>(
    `${BASE_URL}/v2/admin/remote/pi5-render/${paused ? "pause" : "resume"}`,
    { method: "POST" },
  ),
  setPi5AirplayCasting: (casting: boolean) => requestJson<Pi5RenderState>(
    `${BASE_URL}/v2/admin/remote/pi5-airplay/${casting ? "start" : "stop"}`,
    { method: "POST" },
  ),
};

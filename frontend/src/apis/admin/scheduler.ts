import { refreshAccessToken } from "../auth/authSession";

const BASE_URL = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");

export interface ScheduledJobRun {
  job: string;
  host: string;
  startedAt: string;
  finishedAt: string;
  status: "success" | "warning" | "failure";
  summary: string;
  provider: string | null;
  recordedAt: string;
}

export interface SchedulerRuns {
  runs: ScheduledJobRun[];
}

const send = (query: string) =>
  fetch(`${BASE_URL}/v2/admin/scheduler/runs${query}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

export const fetchSchedulerRuns = async (job?: string): Promise<SchedulerRuns> => {
  const query = job ? `?job=${encodeURIComponent(job)}` : "";
  let response = await send(query);
  if (response.status === 401 && (await refreshAccessToken())) response = await send(query);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || body?.detail || "Scheduled job history is unavailable");
  }
  return (body?.response ?? body) as SchedulerRuns;
};

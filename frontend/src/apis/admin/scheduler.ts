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

export interface SchedulerJob {
  slug: string;
  historyKey: string;
  timer: string;
  service: string;
  description: string;
  enabled: boolean;
  active: boolean;
  scheduleDirective: "OnCalendar" | "OnUnitActiveSec" | "OnBootSec" | null;
  scheduleValue: string | null;
  nextRun: string | null;
  lastRun: string | null;
}

export interface SchedulerJobs {
  jobs: SchedulerJob[];
}

export interface ScheduleUpdateResult {
  slug: string;
  directive: string;
  value: string;
  preview: string;
}

const request = async (path: string, options?: RequestInit) => {
  const send = () =>
    fetch(`${BASE_URL}${path}`, {
      ...(options || {}),
      credentials: "include",
      headers: { Accept: "application/json", ...(options?.headers || {}) },
    });
  let response = await send();
  if (response.status === 401 && (await refreshAccessToken())) response = await send();
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || body?.detail || `Request failed (${response.status})`);
  }
  return body?.response ?? body;
};

export const fetchSchedulerRuns = (job?: string): Promise<SchedulerRuns> =>
  request(`/v2/admin/scheduler/runs${job ? `?job=${encodeURIComponent(job)}` : ""}`);

export const fetchSchedulerJobs = (): Promise<SchedulerJobs> =>
  request("/v2/admin/scheduler/jobs");

export const updateJobSchedule = (
  slug: string,
  schedule: string,
): Promise<ScheduleUpdateResult> =>
  request(`/v2/admin/scheduler/jobs/${encodeURIComponent(slug)}/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schedule }),
  });

export const setJobEnabled = (slug: string, enabled: boolean): Promise<{ slug: string; enabled: boolean }> =>
  request(`/v2/admin/scheduler/jobs/${encodeURIComponent(slug)}/${enabled ? "enable" : "disable"}`, {
    method: "POST",
  });

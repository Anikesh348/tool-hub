import { refreshAccessToken } from "../auth/authSession";

const BASE_URL = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");

export interface ProposedQuestion {
  url: string;
  title: string;
  difficulty: string;
  tags: string[];
  acRate?: number | null;
  reason: string;
}

export interface SetGenerationJob {
  id: string;
  status: "running" | "ready" | "failed" | "confirmed";
  label: string | null;
  proposed: ProposedQuestion[];
  skippedExisting: string[];
  unresolvedCount: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateSetRequest {
  topic: string;
  difficulty: "Easy" | "Medium" | "Hard" | "Mixed";
  count: number;
  interviewOnly?: boolean;
  excludePremium?: boolean;
  includeCompanyTags?: boolean;
  customPrompt?: string;
}

const requestJson = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const send = () =>
    fetch(url, {
      ...(options || {}),
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    });
  let response = await send();
  if (response.status === 401 && (await refreshAccessToken())) response = await send();
  const text = await response.text();
  const body = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })()
    : null;
  if (!response.ok) {
    const message =
      body?.error?.message || body?.error || body?.detail || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body?.response as T;
};

export const LeetcodeSetWizardService = {
  beginGeneration: (request: GenerateSetRequest) =>
    requestJson<SetGenerationJob>(`${BASE_URL}/v2/leetcode/ai/sets/generate`, {
      method: "POST",
      body: JSON.stringify(request),
    }),
  getGeneration: (jobId: string) =>
    requestJson<SetGenerationJob>(
      `${BASE_URL}/v2/leetcode/ai/sets/generate/${encodeURIComponent(jobId)}`
    ),
  confirmGeneration: (jobId: string, label: string, excludeUrls: string[] = [], description = "") =>
    requestJson<{ label: string; count: number }>(
      `${BASE_URL}/v2/leetcode/ai/sets/generate/${encodeURIComponent(jobId)}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ label, excludeUrls, description }),
      }
    ),
};

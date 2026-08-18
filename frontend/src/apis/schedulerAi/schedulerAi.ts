import { refreshAccessToken } from "../auth/authSession";

const BASE_URL = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");

export interface ProposedJob {
  name: string;
  description: string;
  kind: "script" | "smart";
  cron: string;
  humanReadable: string;
  scriptAction: string | null;
  scriptParams: Record<string, string> | null;
  prompt: string | null;
  status: "pending" | "confirmed";
  jobId?: string;
}

export interface SchedulerAiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "completed" | "failed";
  proposedJob: ProposedJob | null;
  createdAt: string;
}

export interface SchedulerAiChatSummary {
  id: string;
  title: string;
  runStatus: "idle" | "running";
  createdAt: string;
  updatedAt: string;
}

export interface SchedulerAiChat extends SchedulerAiChatSummary {
  messages: SchedulerAiMessage[];
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

export const SchedulerAiService = {
  listChats: () =>
    requestJson<{ items: SchedulerAiChatSummary[] }>(`${BASE_URL}/v2/admin/scheduler-ai/chats`),
  createChat: (title = "New chat") =>
    requestJson<SchedulerAiChatSummary>(`${BASE_URL}/v2/admin/scheduler-ai/chats`, {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  getChat: (chatId: string) =>
    requestJson<{ chat: SchedulerAiChat }>(
      `${BASE_URL}/v2/admin/scheduler-ai/chats/${encodeURIComponent(chatId)}`
    ),
  sendMessage: (chatId: string, content: string) =>
    requestJson<{ accepted: boolean; userMessage: SchedulerAiMessage }>(
      `${BASE_URL}/v2/admin/scheduler-ai/chats/${encodeURIComponent(chatId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ content }),
      }
    ),
};

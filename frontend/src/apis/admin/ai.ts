import { refreshAccessToken } from "../auth/authSession";

const BASE_URL = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");

export interface AIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "completed" | "failed";
  createdAt: string;
}

export interface AIChatSummary {
  id: string;
  title: string;
  provider: string;
  status: string;
  runStatus: "idle" | "running";
  providerConversationIdPresent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AIChat extends AIChatSummary {
  messages: AIMessage[];
}

const requestJson = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const send = () => fetch(url, {
    ...(options || {}),
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  let response = await send();
  if (response.status === 401 && (await refreshAccessToken())) response = await send();
  const text = await response.text();
  const body = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
  if (!response.ok) {
    const message = body?.error?.message || body?.error || body?.detail || `AI request failed (${response.status})`;
    throw new Error(message);
  }
  return body?.response as T;
};

export const AIService = {
  health: () => requestJson<{ status: string; provider: string }>(`${BASE_URL}/v2/admin/ai/health`),
  listChats: () => requestJson<{ items: AIChatSummary[] }>(`${BASE_URL}/v2/admin/ai/chats`),
  createChat: (title = "New chat") => requestJson<AIChatSummary>(`${BASE_URL}/v2/admin/ai/chats`, {
    method: "POST",
    body: JSON.stringify({ title, provider: "codex" }),
  }),
  getChat: (chatId: string) => requestJson<{ chat: AIChat }>(
    `${BASE_URL}/v2/admin/ai/chats/${encodeURIComponent(chatId)}`,
  ),
  sendMessage: (chatId: string, content: string) => requestJson<{
    accepted: boolean;
    userMessage: AIMessage;
  }>(`${BASE_URL}/v2/admin/ai/chats/${encodeURIComponent(chatId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  }),
};

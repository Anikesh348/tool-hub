import { refreshAccessToken } from "../auth/authSession";

const BASE_URL = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");

export interface LeetcodeAiAddedCollection {
  label: string;
  count: number;
  questions: Array<{
    questionId: string;
    url: string;
    title: string;
    difficulty: string;
    tags: string[];
  }>;
}

export interface LeetcodeAiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "completed" | "failed";
  addedCollection: LeetcodeAiAddedCollection | null;
  createdAt: string;
}

export interface LeetcodeAiChatSummary {
  id: string;
  title: string;
  runStatus: "idle" | "running";
  createdAt: string;
  updatedAt: string;
}

export interface LeetcodeAiChat extends LeetcodeAiChatSummary {
  messages: LeetcodeAiMessage[];
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

export const LeetcodeAiService = {
  listChats: () =>
    requestJson<{ items: LeetcodeAiChatSummary[] }>(`${BASE_URL}/v2/leetcode/ai/chats`),
  createChat: (title = "New chat") =>
    requestJson<LeetcodeAiChatSummary>(`${BASE_URL}/v2/leetcode/ai/chats`, {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  getChat: (chatId: string) =>
    requestJson<{ chat: LeetcodeAiChat }>(
      `${BASE_URL}/v2/leetcode/ai/chats/${encodeURIComponent(chatId)}`
    ),
  sendMessage: (chatId: string, content: string) =>
    requestJson<{ accepted: boolean; userMessage: LeetcodeAiMessage }>(
      `${BASE_URL}/v2/leetcode/ai/chats/${encodeURIComponent(chatId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ content }),
      }
    ),
};

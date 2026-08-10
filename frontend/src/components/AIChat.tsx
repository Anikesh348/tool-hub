import React, { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { Bot, Check, Copy, Menu, MessageSquarePlus, Send, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { AIChat as AIChatType, AIChatSummary, AIMessage, AIService } from "../apis/admin/ai";

const POLL_INTERVAL_MS = 1000;
const RESPONSE_TIMEOUT_MS = 330_000;

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const formatTimestamp = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${date.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
};

const AIChat = () => {
  const [chats, setChats] = useState<AIChatSummary[]>([]);
  const [activeChat, setActiveChat] = useState<AIChatType | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [gatewayReady, setGatewayReady] = useState<boolean | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const copyResetRef = useRef<number>();

  const copyMessage = async (message: AIMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      window.clearTimeout(copyResetRef.current);
      copyResetRef.current = window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      /* clipboard permission denied — silently ignore */
    }
  };

  const loadChat = async (chatId: string) => {
    setError("");
    const result = await AIService.getChat(chatId);
    setActiveChat(result.chat);
    setSidebarOpen(false);
  };

  const refreshList = async (preferredId?: string) => {
    const result = await AIService.listChats();
    setChats(result.items);
    const nextId = preferredId || activeChat?.id || result.items[0]?.id;
    if (nextId) await loadChat(nextId);
    else setActiveChat(null);
  };

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([AIService.listChats(), AIService.health()]).then(async ([chatResult, healthResult]) => {
      if (cancelled) return;
      setGatewayReady(healthResult.status === "fulfilled");
      if (chatResult.status === "rejected") {
        setError(chatResult.reason?.message || "Chats could not be loaded");
        setLoading(false);
        return;
      }
      setChats(chatResult.value.items);
      if (chatResult.value.items[0]) {
        try {
          const result = await AIService.getChat(chatResult.value.items[0].id);
          if (!cancelled) setActiveChat(result.chat);
        } catch (err: any) {
          if (!cancelled) setError(err?.message || "Chat could not be loaded");
        }
      }
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages, sending]);

  const createChat = async () => {
    setError("");
    try {
      const created = await AIService.createChat();
      await refreshList(created.id);
      setInput("");
    } catch (err: any) {
      setError(err?.message || "A new chat could not be created");
    }
  };

  const waitForAssistant = async (chatId: string) => {
    const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const result = await AIService.getChat(chatId);
      setActiveChat(result.chat);
      if (result.chat.runStatus === "idle") {
        const lastMessage = result.chat.messages[result.chat.messages.length - 1];
        if (lastMessage?.status === "failed") {
          throw new Error("The assistant could not complete this request");
        }
        return;
      }
      await wait(POLL_INTERVAL_MS);
    }
    throw new Error("The assistant is still working. Reload this chat in a moment.");
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const content = input.trim();
    if (!content || sending) return;
    setError("");
    setSending(true);
    try {
      let chat = activeChat;
      if (!chat) {
        const created = await AIService.createChat();
        const loaded = await AIService.getChat(created.id);
        chat = loaded.chat;
        setActiveChat(chat);
      }
      const optimistic: AIMessage = {
        id: `pending-${Date.now()}`,
        role: "user",
        content,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      setActiveChat({ ...chat, messages: [...chat.messages, optimistic] });
      setInput("");
      const result = await AIService.sendMessage(chat.id, content);
      setActiveChat((current) => current ? {
        ...current,
        messages: [
          ...current.messages.filter((message) => message.id !== optimistic.id),
          result.userMessage,
        ],
      } : current);
      await waitForAssistant(chat.id);
      const listed = await AIService.listChats();
      setChats(listed.items);
    } catch (err: any) {
      setError(err?.message || "The assistant could not complete this request");
      if (activeChat?.id) {
        try { await loadChat(activeChat.id); } catch { /* keep the visible error */ }
      }
    } finally {
      setSending(false);
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const sidebar = (
    <aside className="flex h-full w-[290px] shrink-0 flex-col border-r border-white/[0.07] bg-[#080c14]">
      <div className="flex h-16 items-center justify-between border-b border-white/[0.07] px-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-400">ToolHub AI</p>
          <p className="mt-1 text-sm font-bold text-white">Conversations</p>
        </div>
        <button onClick={() => setSidebarOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white lg:hidden" aria-label="Close conversations">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-3">
        <button onClick={createChat} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-violet-400">
          <MessageSquarePlus className="h-4 w-4" /> New chat
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {chats.map((chat) => (
          <button
            key={chat.id}
            onClick={() => loadChat(chat.id).catch((err) => setError(err?.message || "Chat could not be loaded"))}
            className={`w-full rounded-xl px-3 py-3 text-left transition ${activeChat?.id === chat.id ? "bg-violet-500/15 text-white" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"}`}
          >
            <span className="block truncate text-sm font-semibold">{chat.title}</span>
            <span className="mt-1 block text-[10px] uppercase tracking-wider text-slate-600">{chat.provider}</span>
          </button>
        ))}
      </div>
      <div className="border-t border-white/[0.07] p-4 text-[11px] text-slate-500">
        <span className={`mr-2 inline-block h-2 w-2 rounded-full ${gatewayReady ? "bg-emerald-400" : gatewayReady === false ? "bg-rose-400" : "bg-slate-500"}`} />
        {gatewayReady ? "Codex connected" : gatewayReady === false ? "Codex unavailable" : "Checking Codex"}
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-[#060911] pt-16 text-slate-100">
      <div className="hidden lg:block">{sidebar}</div>
      {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      {sidebarOpen && <div className="fixed bottom-0 left-0 top-16 z-50 lg:hidden">{sidebar}</div>}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.07] bg-[#080c14]/90 px-4 sm:px-6">
          <button onClick={() => setSidebarOpen(true)} className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white lg:hidden" aria-label="Open conversations">
            <Menu className="h-5 w-5" />
          </button>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300"><Bot className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold text-white">{activeChat?.title || "AI Assistant"}</h1>
            <p className="text-[10px] text-slate-500">Read-only Codex assistant</p>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6">
          <div className="mx-auto max-w-3xl">
            {loading ? (
              <div className="py-20 text-center text-sm text-slate-500">Loading conversations...</div>
            ) : !activeChat || activeChat.messages.length === 0 ? (
              <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/25 to-blue-500/20 text-violet-200"><Sparkles className="h-7 w-7" /></span>
                <h2 className="mt-5 text-2xl font-black text-white">How can I help?</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">Ask a general question, look up current public information, or inspect hp-codex safely. Changes remain blocked.</p>
              </div>
            ) : (
              <div className="space-y-5">
                {activeChat.messages.map((message) => {
                  const isUser = message.role === "user";
                  return (
                    <article key={message.id} className={`group flex items-start gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}>
                      {!isUser && (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
                          <Bot className="h-4 w-4" />
                        </span>
                      )}
                      <div className={`flex min-w-0 flex-col ${isUser ? "items-end" : "items-start"}`}>
                        <div className={isUser ? "max-w-[88%] rounded-2xl rounded-br-md bg-violet-500 px-4 py-3 text-sm leading-6 text-white" : "max-w-full rounded-2xl rounded-bl-md border border-white/[0.08] bg-white/[0.035] px-5 py-4 text-sm leading-7 text-slate-200"}>
                          {message.role === "assistant" ? (
                            <div className="ai-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>
                          ) : message.content}
                          {message.status === "failed" && <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-rose-200">Not delivered</p>}
                        </div>
                        <div className={`mt-1 flex items-center gap-2 px-1 text-[10px] text-slate-600 ${isUser ? "flex-row-reverse" : ""}`}>
                          <span>{formatTimestamp(message.createdAt)}</span>
                          {message.status !== "pending" && (
                            <button
                              onClick={() => copyMessage(message)}
                              className="flex items-center gap-1 rounded-md p-1 opacity-0 transition hover:bg-white/5 hover:text-slate-300 group-hover:opacity-100 focus-visible:opacity-100"
                              aria-label="Copy message"
                            >
                              {copiedId === message.id ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-400" />
                                  <span className="text-emerald-400">Copied</span>
                                </>
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
                {sending && (
                  <div className="flex items-start gap-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
                      <Bot className="h-4 w-4" />
                    </span>
                    <div className="rounded-2xl rounded-bl-md border border-white/[0.08] bg-white/[0.035] px-5 py-4 text-sm text-slate-500">
                      <span className="animate-pulse">Codex is thinking...</span>
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-white/[0.07] bg-[#080c14] px-4 py-4 sm:px-6">
          <form onSubmit={submit} className="mx-auto max-w-3xl">
            {error && <div className="mb-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">{error}</div>}
            <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-black/20 p-2 focus-within:border-violet-400/50">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onComposerKeyDown}
                disabled={sending}
                rows={1}
                maxLength={16000}
                placeholder="Message the assistant..."
                className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-3 text-sm text-white outline-none placeholder:text-slate-600"
              />
              <button type="submit" disabled={!input.trim() || sending} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500 text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Send message">
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-slate-600">Enter to send · Shift+Enter for a new line</p>
          </form>
        </div>
      </section>
    </div>
  );
};

export default AIChat;

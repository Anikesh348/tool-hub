import React, { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { Bot, CalendarClock, ChevronDown, MessageSquarePlus, Send, ShieldAlert, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { createUserJob } from "../apis/admin/scheduler";
import {
  ProposedJob,
  SchedulerAiChat,
  SchedulerAiChatSummary,
  SchedulerAiMessage,
  SchedulerAiService,
} from "../apis/schedulerAi/schedulerAi";

const ACTIVE_CHAT_STORAGE_KEY = "scheduler-ai-active-chat-id";

type Props = {
  onJobCreated: () => void;
};

const ProposalCard: React.FC<{
  chatId: string;
  message: SchedulerAiMessage;
  proposal: ProposedJob;
  onConfirmed: () => void;
}> = ({ chatId, message, proposal, onConfirmed }) => {
  const [confirming, setConfirming] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState("");

  if (dismissed) return null;

  const confirm = async () => {
    setConfirming(true);
    setError("");
    try {
      await createUserJob(
        {
          name: proposal.name,
          description: proposal.description,
          kind: proposal.kind,
          schedule: { cron: proposal.cron, humanReadable: proposal.humanReadable },
          scriptAction: proposal.scriptAction,
          scriptParams: proposal.scriptParams,
          prompt: proposal.prompt,
        },
        chatId,
        message.id,
      );
      onConfirmed();
    } catch (err: any) {
      setError(err?.message || "Could not create the scheduled job");
    } finally {
      setConfirming(false);
    }
  };

  const confirmed = proposal.status === "confirmed";

  return (
    <div className="mt-3 rounded-xl border border-violet-500/20 bg-violet-500/10 p-3">
      <div className="flex items-center gap-1.5 text-xs font-bold text-violet-200">
        <CalendarClock className="h-3.5 w-3.5" />
        {proposal.name}
      </div>
      <p className="mt-1 text-[11px] text-violet-200/70">
        {proposal.humanReadable || proposal.cron} &middot; {proposal.kind === "smart" ? "Smart (operator)" : "Script"}
      </p>
      {proposal.kind === "smart" && !confirmed && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-400/10 px-2 py-1.5 text-[10px] text-amber-200">
          <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
          Runs with real administrative access every time it fires, unattended.
        </div>
      )}
      {error && <p className="mt-2 text-[11px] text-rose-300">{error}</p>}
      {confirmed ? (
        <p className="mt-2 text-[11px] font-semibold text-emerald-300">Created — see it in the jobs list.</p>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            onClick={confirm}
            disabled={confirming}
            className="rounded-lg bg-violet-500/20 px-2.5 py-1 text-[11px] font-semibold text-violet-200 hover:bg-violet-500/30 disabled:opacity-50"
          >
            {confirming ? "Creating..." : "Confirm & create"}
          </button>
          <button
            onClick={() => setDismissed(true)}
            disabled={confirming}
            className="rounded-lg px-2.5 py-1 text-[11px] font-semibold text-slate-400 hover:bg-white/5 hover:text-slate-200 disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
};

const SchedulerAIBubble: React.FC<Props> = ({ onJobCreated }) => {
  const [open, setOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [chats, setChats] = useState<SchedulerAiChatSummary[]>([]);
  const [activeChat, setActiveChat] = useState<SchedulerAiChat | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sending) {
      setElapsedSeconds(0);
      return;
    }
    const intervalId = window.setInterval(() => {
      setElapsedSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [sending]);

  const loadChat = async (chatId: string) => {
    const result = await SchedulerAiService.getChat(chatId);
    setActiveChat(result.chat);
    window.localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, chatId);
    setHistoryOpen(false);
  };

  const bootstrap = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await SchedulerAiService.listChats();
      setChats(result.items);
      const remembered = window.localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY);
      const preferred =
        (remembered && result.items.find((chat) => chat.id === remembered)?.id) ||
        result.items[0]?.id;
      if (preferred) await loadChat(preferred);
    } catch (err: any) {
      setError(err?.message || "Could not load conversations");
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  };

  useEffect(() => {
    if (open && !initialized) void bootstrap();
  }, [open, initialized]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages, sending]);

  const createChat = async () => {
    setError("");
    try {
      const created = await SchedulerAiService.createChat();
      const result = await SchedulerAiService.listChats();
      setChats(result.items);
      await loadChat(created.id);
      setInput("");
    } catch (err: any) {
      setError(err?.message || "A new chat could not be created");
    }
  };

  const wait = (milliseconds: number) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  const waitForAssistant = async (chatId: string) => {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const result = await SchedulerAiService.getChat(chatId);
      setActiveChat(result.chat);
      if (result.chat.runStatus === "idle") {
        const lastMessage = result.chat.messages[result.chat.messages.length - 1];
        if (lastMessage?.status === "failed") {
          throw new Error("The assistant could not complete this request");
        }
        return;
      }
      await wait(1000);
    }
    throw new Error("This is taking longer than expected. Reopen the chat in a moment.");
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
        const created = await SchedulerAiService.createChat();
        const loaded = await SchedulerAiService.getChat(created.id);
        chat = loaded.chat;
        setActiveChat(chat);
        window.localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, chat.id);
      }
      const optimistic: SchedulerAiMessage = {
        id: `pending-${Date.now()}`,
        role: "user",
        content,
        status: "completed",
        proposedJob: null,
        createdAt: new Date().toISOString(),
      };
      setActiveChat({ ...chat, messages: [...chat.messages, optimistic] });
      setInput("");
      const result = await SchedulerAiService.sendMessage(chat.id, content);
      setActiveChat((current) =>
        current
          ? {
              ...current,
              messages: [
                ...current.messages.filter((message) => message.id !== optimistic.id),
                result.userMessage,
              ],
            }
          : current
      );
      await waitForAssistant(chat.id);
      const listed = await SchedulerAiService.listChats();
      setChats(listed.items);
    } catch (err: any) {
      setError(err?.message || "The assistant could not complete this request");
      if (activeChat?.id) {
        try {
          const reloaded = await SchedulerAiService.getChat(activeChat.id);
          setActiveChat(reloaded.chat);
        } catch {
          // keep the visible error
        }
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

  const handleConfirmed = async () => {
    onJobCreated();
    if (activeChat?.id) {
      try {
        const reloaded = await SchedulerAiService.getChat(activeChat.id);
        setActiveChat(reloaded.chat);
      } catch {
        // the job was still created; a stale card is a cosmetic issue only
      }
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-blue-600 text-white shadow-2xl shadow-violet-900/40 transition-transform hover:scale-105 active:scale-95"
        aria-label={open ? "Close Scheduled Jobs AI assistant" : "Open Scheduled Jobs AI assistant"}
      >
        {open ? <X className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
      </button>

      {open && (
        <div className="fixed bottom-24 right-4 sm:right-6 z-40 flex h-[70vh] max-h-[600px] w-[92vw] sm:w-[400px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0e17] shadow-2xl">
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.07] bg-[#0d1220] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white">
                  {activeChat?.title || "Scheduler AI"}
                </p>
                <p className="text-[10px] text-slate-500">Describe an automation to schedule it</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <div className="relative">
                <button
                  onClick={() => setHistoryOpen((value) => !value)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"
                  aria-label="Conversation history"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                {historyOpen && (
                  <div className="absolute right-0 top-9 z-50 max-h-64 w-64 overflow-y-auto rounded-xl border border-white/10 bg-[#0d1220] p-1.5 shadow-2xl">
                    {chats.length === 0 && (
                      <p className="px-3 py-2 text-xs text-slate-500">No conversations yet</p>
                    )}
                    {chats.map((chat) => (
                      <button
                        key={chat.id}
                        onClick={() => void loadChat(chat.id)}
                        className={`block w-full truncate rounded-lg px-3 py-2 text-left text-xs ${
                          activeChat?.id === chat.id
                            ? "bg-violet-500/15 text-white"
                            : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                        }`}
                      >
                        {chat.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={createChat}
                className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"
                aria-label="Start a new chat"
                title="New chat"
              >
                <MessageSquarePlus className="h-4 w-4" />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
            {loading ? (
              <div className="py-16 text-center text-xs text-slate-500">Loading...</div>
            ) : !activeChat || activeChat.messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                <Sparkles className="h-8 w-8 text-violet-400" />
                <p className="mt-3 text-sm font-semibold text-white">What should I schedule?</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Try &ldquo;check the homepage every hour and alert me if it's down&rdquo; — I'll
                  propose a job and ask you to confirm before creating it.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {activeChat.messages.map((message) => (
                  <article
                    key={message.id}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={
                        message.role === "user"
                          ? "max-w-[85%] rounded-2xl rounded-br-md bg-violet-500 px-3.5 py-2.5 text-sm leading-6 text-white"
                          : "max-w-full rounded-2xl rounded-bl-md border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm leading-6 text-slate-200"
                      }
                    >
                      {message.role === "assistant" ? (
                        <div className="ai-markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                        </div>
                      ) : (
                        message.content
                      )}
                      {message.proposedJob && activeChat && (
                        <ProposalCard
                          chatId={activeChat.id}
                          message={message}
                          proposal={message.proposedJob}
                          onConfirmed={handleConfirmed}
                        />
                      )}
                    </div>
                  </article>
                ))}
                {sending && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-md border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-xs text-slate-500">
                      <span className="animate-pulse">
                        Thinking{elapsedSeconds > 0 ? ` (${elapsedSeconds}s)` : "..."}
                      </span>
                      {elapsedSeconds >= 8 && (
                        <p className="mt-1 text-[10px] text-slate-600">
                          Longer requests can take up to a minute — no need to reload.
                        </p>
                      )}
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-white/[0.07] bg-[#0d1220] px-3 py-3">
            <form onSubmit={submit}>
              {error && (
                <div className="mb-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
                  {error}
                </div>
              )}
              <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-black/20 p-1.5 focus-within:border-violet-400/50">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={onComposerKeyDown}
                  disabled={sending}
                  rows={1}
                  maxLength={4000}
                  placeholder="Describe the automation you need..."
                  className="max-h-28 min-h-[38px] flex-1 resize-none bg-transparent px-2.5 py-2 text-sm text-white outline-none placeholder:text-slate-600"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || sending}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500 text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default SchedulerAIBubble;

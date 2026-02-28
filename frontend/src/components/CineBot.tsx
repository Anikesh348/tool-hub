import React, { useState, useRef, useEffect, useMemo } from "react";
import { Bot, Sparkles, SendHorizontal, Expand, Minimize2, X } from "lucide-react";
import { CinePilotService } from "../apis/cinebot/cinebot";
import { useApiFetcher } from "../hooks/useApiFetcher";
import { Loader } from "./Loader";
import { useAuth } from "../context/AuthContext";

type ChatMode = "widget" | "page";

interface Props {
  mode?: ChatMode;
  onClose?: () => void;
  onExpand?: () => void;
  onCollapseToWidget?: () => void;
}

interface ChatOption {
  id?: string;
  value?: string;
  label?: string;
  title?: string;
  year?: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  type?: "error";
  options?: ChatOption[];
}

interface FeatureItem {
  id: string;
  label: string;
  value: string;
  description: string;
}

const ADMIN_FEATURES: FeatureItem[] = [
  {
    id: "admin-download",
    label: "Download a movie/series",
    value: "Download Interstellar in 1080p",
    description: "Directly queue downloads with quality and seasons.",
  },
  {
    id: "admin-exists",
    label: "Check server availability",
    value: "Check if Blade Runner exists on the server",
    description: "Check if a movie/series already exists on the server library.",
  },
  {
    id: "admin-status",
    label: "Check download status",
    value: "Show all downloads status",
    description: "Check status for all requests or ask for a particular media title.",
  },
];

const USER_FEATURES: FeatureItem[] = [
  {
    id: "user-request",
    label: "Request a movie/series",
    value: "Request The Matrix in 1080p",
    description: "Raise media requests for admin approval.",
  },
  {
    id: "user-exists",
    label: "Check server availability",
    value: "Check if Blade Runner exists on the server",
    description: "Check if a movie/series already exists on the server library.",
  },
  {
    id: "user-status",
    label: "Check download status",
    value: "What are the status of my downloads?",
    description: "Check status for all your requests or for a particular media title.",
  },
];

export const CinePilotChat: React.FC<Props> = ({
  mode = "widget",
  onClose,
  onExpand,
  onCollapseToWidget,
}) => {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversationIdRef = useRef<string>(crypto.randomUUID());

  const { loading, data, error, fetchData } = useApiFetcher();

  const featureItems = useMemo(
    () => (isAdmin ? ADMIN_FEATURES : USER_FEATURES),
    [isAdmin]
  );

  const placeholder = isAdmin
    ? "Download/check/search status..."
    : "Request/check/search status...";

  const dispatchUserMessage = (userMessage: string) => {
    if (!userMessage.trim() || loading) return;
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    const { url, options } = CinePilotService.chat(
      userMessage,
      conversationIdRef.current
    );
    fetchData(url, options);
  };

  const sendMessage = () => {
    if (!input.trim() || loading) return;
    const userMessage = input.trim();
    setInput("");
    dispatchUserMessage(userMessage);
  };

  const sendSelection = (option: ChatOption) => {
    const selectedValue =
      option.value || option.id || option.label || option.title;
    if (!selectedValue) return;
    dispatchUserMessage(selectedValue);
  };

  const getOptionLabel = (option: ChatOption, idx: number) =>
    option.label || option.title || option.value || option.id || `Option ${idx + 1}`;

  useEffect(() => {
    if (!data) return;

    if (data.status >= 200 && data.status < 300 && data.body) {
      const responsePayload = data.body.response;
      const responseMessage =
        typeof responsePayload === "string"
          ? responsePayload
          : responsePayload?.message ||
            "Request accepted. Automation in progress.";
      const responseOptions =
        typeof responsePayload === "object" &&
        responsePayload !== null &&
        Array.isArray(responsePayload.options)
          ? responsePayload.options
          : undefined;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: responseMessage,
          options: responseOptions,
        },
      ]);
    } else if (data.status >= 400) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          type: "error",
          content:
            data.body?.error ||
            error ||
            "Something went wrong. Please try again.",
        },
      ]);
    }
  }, [data, error]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const wrapperClass =
    mode === "widget"
      ? "fixed bottom-4 right-2 sm:bottom-6 sm:right-6 z-50 w-[calc(100vw-1rem)] sm:w-[430px] h-[min(76vh,620px)]"
      : "w-full h-full min-h-[calc(100vh-260px)]";

  return (
    <div className={wrapperClass}>
      <div
        className="
          moviehub-panel rounded-2xl
          shadow-2xl flex h-full flex-col overflow-hidden relative
        "
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/80 to-transparent" />
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2 bg-white/50 dark:bg-slate-900/30">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 text-white grid place-items-center shadow-lg shadow-blue-500/30">
              <Bot size={16} />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">
                CinePilot Assistant
              </h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                <span className="inline-flex items-center mr-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1" />
                </span>
                {isAdmin ? "Admin mode" : "User mode"} • MovieHub AI
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mode === "widget" && onExpand && (
              <button
                onClick={onExpand}
                className="text-xs px-2 py-1 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition inline-flex items-center gap-1"
                title="Open full page"
              >
                <Expand size={12} />
                Expand
              </button>
            )}
            {mode === "page" && onCollapseToWidget && (
              <button
                onClick={onCollapseToWidget}
                className="text-xs px-2 py-1 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition inline-flex items-center gap-1"
                title="Collapse to widget"
              >
                <Minimize2 size={12} />
                Minimize
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
                title={mode === "page" ? "Back to MovieHub" : "Close"}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gradient-to-b from-white/30 to-transparent dark:from-slate-900/20">
          {messages.length === 0 && (
            <div className="space-y-3">
              <div className="rounded-xl border border-blue-200/50 dark:border-blue-700/50 bg-blue-50/70 dark:bg-blue-900/20 p-3">
                <p className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Sparkles size={14} className="text-blue-500" />
                  Available features
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                  {isAdmin
                    ? "You can download directly and monitor all queues."
                    : "You can raise requests and monitor your queue items."}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {featureItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setInput(item.value);
                      inputRef.current?.focus();
                    }}
                    className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 p-3 hover:border-blue-400 dark:hover:border-blue-500 transition"
                  >
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {item.label}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {item.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, idx) => {
            const hasOptions =
              m.role === "assistant" && m.options && m.options.length > 0;
            return (
              <div
                key={idx}
                className={`flex ${
                  m.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`
                    inline-block max-w-[92%]
                    px-3 py-2 rounded-2xl text-sm leading-snug shadow-sm
                    ${
                      m.type === "error"
                        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                      : m.role === "user"
                        ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                        : "bg-gray-100 dark:bg-gray-700/90 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600"
                    }
                  `}
                >
                  <div>{m.content}</div>
                  {hasOptions && (
                    <div className="mt-2 grid grid-cols-1 gap-2">
                      {m.options?.map((option, optionIdx) => (
                        <button
                          key={`${idx}-${optionIdx}-${getOptionLabel(option, optionIdx)}`}
                          type="button"
                          disabled={loading}
                          onClick={() => sendSelection(option)}
                          className="
                            w-full rounded-lg border border-blue-400/40
                            bg-blue-600/10 px-2 py-1.5 text-left text-xs text-blue-700 dark:text-blue-100
                            hover:bg-blue-600/20 disabled:opacity-50
                          "
                        >
                          {getOptionLabel(option, optionIdx)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {loading && (
            <div className="mr-auto flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>Analysing</span>
              <Loader size="sm" />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 space-y-2 bg-white/40 dark:bg-slate-900/25">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={placeholder}
            className="
              w-full px-3 py-2 rounded-lg resize-none
              bg-white/90 dark:bg-gray-800
              border border-gray-300 dark:border-gray-600
              text-sm text-gray-900 dark:text-white
              placeholder-gray-400
              focus:outline-none focus:ring-2 focus:ring-blue-500
            "
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Press Enter to send, Shift+Enter for new line
            </p>
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="
                px-4 py-2 rounded-lg inline-flex items-center gap-1.5
                bg-gradient-to-r from-blue-600 to-purple-600
                text-white text-sm font-semibold
                hover:shadow-lg
                active:scale-95
                disabled:opacity-50
                transition
              "
            >
              <SendHorizontal size={14} />
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

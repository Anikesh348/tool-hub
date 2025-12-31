import React, { useState, useRef, useEffect } from "react";
import { CinePilotService } from "../apis/cinebot/cinebot";
import { useApiFetcher } from "../hooks/useApiFetcher";
import { Loader } from "./Loader";
import { CinePilotTemplates } from "./CinePilotTemplates";
import { CINE_PILOT_TEMPLATES } from "./CinePilotTemplate";

interface Props {
  onClose: () => void;
}

export const CinePilotChat: React.FC<Props> = ({ onClose }) => {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { loading, data, fetchData } = useApiFetcher();

  const sendMessage = () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");

    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    const { url, options } = CinePilotService.chat(userMessage);
    fetchData(url, options);
  };

  useEffect(() => {
    if (data?.status === 200 && data?.body) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            data.body.message || "✅ Request accepted. Automation in progress.",
        },
      ]);
    }
  }, [data]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div
        className="
          w-[360px] sm:w-[400px]
          h-[520px]
          glass-card rounded-2xl
          shadow-2xl
          flex flex-col
          animate-slide-up
        "
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">
            🎬 CinePilot AI{" "}
            <span className="text-xs font-semibold text-yellow-600">
              (Beta)
            </span>
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* Message templates */}
          {messages.length === 0 && (
            <CinePilotTemplates
              templates={CINE_PILOT_TEMPLATES}
              onSelect={(value) => setInput(value)}
            />
          )}

          {/* Messages */}
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`max-w-[80%] px-3 py-2 rounded-xl text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "ml-auto bg-blue-600 text-white"
                  : "mr-auto bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
              }`}
            >
              {m.content}
            </div>
          ))}

          {/* Analysing loader */}
          {loading && (
            <div className="mr-auto flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>Analysing</span>
              <Loader size="sm" />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Add movie / series / quality..."
            className="
              flex-1 px-3 py-2 rounded-lg
              bg-white dark:bg-gray-800
              border border-gray-300 dark:border-gray-600
              text-sm text-gray-900 dark:text-white
              placeholder-gray-400
              focus:outline-none focus:ring-2 focus:ring-blue-500
            "
          />

          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="
              px-4 py-2 rounded-lg
              bg-gradient-to-r from-blue-600 to-purple-600
              text-white text-sm font-semibold
              hover:shadow-lg
              active:scale-95
              disabled:opacity-50
              transition
            "
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

import React from "react";
import { Bot } from "lucide-react";

interface Props {
  onClick: () => void;
}

export const CinePilotLauncher: React.FC<Props> = ({ onClick }) => {
  return (
    <button
      onClick={onClick}
      className="
        fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50
        w-14 h-14 rounded-2xl
        bg-gradient-to-br from-blue-600 via-violet-600 to-fuchsia-600
        text-white
        shadow-xl shadow-blue-500/30 hover:shadow-2xl
        hover:scale-105 active:scale-95
        transition-all
        border border-white/20
      "
      title="CinePilot AI"
    >
      <span className="absolute -inset-1 rounded-2xl bg-blue-400/30 blur-md -z-10" />
      <span className="inline-flex items-center justify-center w-full h-full">
        <Bot size={22} />
      </span>
    </button>
  );
};

import React from "react";

interface Props {
  onClick: () => void;
}

export const CinePilotLauncher: React.FC<Props> = ({ onClick }) => {
  return (
    <button
      onClick={onClick}
      className="
        fixed bottom-6 right-6 z-50
        w-14 h-14 rounded-full
        bg-gradient-to-br from-purple-600 to-blue-600
        text-white text-xl font-bold
        shadow-xl hover:shadow-2xl
        hover:scale-105 active:scale-95
        transition-all
      "
      title="CinePilot AI"
    >
      🎬
    </button>
  );
};

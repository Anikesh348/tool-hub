import React from "react";
import { CinePilotTemplate } from "./CinePilotTemplate";

interface Props {
  templates: CinePilotTemplate[];
  onSelect: (value: string) => void;
}

export const CinePilotTemplates: React.FC<Props> = ({
  templates,
  onSelect,
}) => {
  if (!templates.length) return null;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Try one of these:
        </p>

        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t.value)}
            className="
              w-full text-left
              px-3 py-2 rounded-lg
              bg-gray-100 dark:bg-gray-800
              text-sm text-gray-700 dark:text-gray-300
              hover:bg-gray-200 dark:hover:bg-gray-700
              transition
            "
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Accuracy hint */}
      <div
        className="
          text-[11px]
          text-gray-500 dark:text-gray-400
          bg-blue-50 dark:bg-blue-900/20
          border border-blue-200 dark:border-blue-800
          rounded-lg
          px-3 py-2
        "
      >
        ℹ️ Please use the{" "}
        <span className="font-semibold">exact movie or show title</span> for
        best results.
      </div>
    </div>
  );
};

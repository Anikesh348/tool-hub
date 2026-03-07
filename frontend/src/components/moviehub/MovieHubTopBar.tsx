import React from "react";

type MovieHubTopBarProps = {
  sectionLabel: string;
  compactLabel: string;
  onOpenMobileNav: () => void;
};

export const MovieHubTopBar: React.FC<MovieHubTopBarProps> = React.memo(
  ({ sectionLabel, compactLabel, onOpenMobileNav }) => {
    return (
      <div className="moviehub-panel rounded-2xl px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 relative overflow-hidden">
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-cyan-400 via-blue-500 to-violet-500" />
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-extrabold text-gray-900 dark:text-white tracking-tight truncate">
            MovieHub
          </h1>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 truncate">
            {sectionLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 dark:bg-slate-800 text-blue-700 dark:text-blue-300 border border-blue-200/70 dark:border-slate-700">
            {compactLabel}
          </span>
          <button
            onClick={onOpenMobileNav}
            className="md:hidden px-3 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 text-white"
          >
            Menu
          </button>
        </div>
      </div>
    );
  }
);

MovieHubTopBar.displayName = "MovieHubTopBar";

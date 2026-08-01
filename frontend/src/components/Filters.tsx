import React, { useState } from "react";
import TagsFilterModal from "./TagsFilterModal";
import { Search, Tags } from "lucide-react";

type Props = {
  difficulty: string;
  solved: string;
  tagsOptions: string[];
  questions: any[];
  onDifficultyChange: (val: string) => void;
  onSolvedChange: (val: string) => void;
  onApplyTags: (tags: string[], operation: "union" | "intersection") => void;
  onSearchChange?: (val: string) => void;
  searchQuery?: string;
  applying?: boolean;
  tagsModalKey?: number;
};

const Filters: React.FC<Props> = ({
  difficulty,
  solved,
  tagsOptions,
  questions,
  onDifficultyChange,
  onSolvedChange,
  onApplyTags,
  onSearchChange,
  searchQuery = "",
  applying,
  tagsModalKey,
}) => {
  const [tagsModalOpen, setTagsModalOpen] = useState(false);

  return (
    <div className="tool-workspace-card p-4 sm:p-5 space-y-3 sm:space-y-4 transition-colors duration-300">
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
        Filters
      </h3>

      {/* Search Bar */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search by title or number..."
          value={searchQuery}
          onChange={(e) => onSearchChange?.(e.target.value)}
          className="w-full border border-gray-200 dark:border-gray-600 rounded-lg pl-10 pr-4 py-2 sm:py-2.5 text-sm sm:text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
        />
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      </div>

      {/* Mobile: Stacked | Desktop: Side by side */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4">
        {/* Difficulty */}
        <div>
          <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 sm:mb-2">
            Difficulty
          </label>
          <select
            value={difficulty}
            onChange={(e) => onDifficultyChange(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg p-2 sm:p-2.5 text-xs sm:text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition cursor-pointer"
          >
            <option value="all">All</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>

        {/* Solved */}
        <div>
          <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 sm:mb-2">
            Status
          </label>
          <select
            value={solved}
            onChange={(e) => onSolvedChange(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg p-2 sm:p-2.5 text-xs sm:text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition cursor-pointer"
          >
            <option value="all">All</option>
            <option value="solved">Solved</option>
            <option value="unsolved">Unsolved</option>
          </select>
        </div>

        {/* Tags Filter Button */}
        <div>
          <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 sm:mb-2 invisible">
            Tags
          </label>
          <button
            type="button"
            onClick={() => setTagsModalOpen(true)}
            className="w-full px-2 sm:px-4 py-2 sm:py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 hover:shadow-lg active:scale-95 text-white rounded-lg font-medium text-xs sm:text-sm transition-all"
          >
            <Tags className="mr-1.5 inline h-4 w-4" />
            Tags
          </button>
        </div>
      </div>

      <TagsFilterModal
        key={tagsModalKey}
        tagsOptions={tagsOptions}
        open={tagsModalOpen}
        onClose={() => setTagsModalOpen(false)}
        onSubmit={(tags, operation) => {
          setTagsModalOpen(false);
          onApplyTags(tags, operation);
        }}
        applying={applying}
      />
    </div>
  );
};

export default Filters;

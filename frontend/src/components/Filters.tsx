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
    <div className="tool-workspace-card p-3 sm:p-4 transition-colors duration-300">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        {/* Search Bar */}
        <div className="relative flex-1 min-w-0">
          <input
            type="text"
            placeholder="Search by title or number..."
            value={searchQuery}
            onChange={(e) => onSearchChange?.(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg pl-9 pr-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
          />
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <select
            value={difficulty}
            onChange={(e) => onDifficultyChange(e.target.value)}
            className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-2 text-xs sm:text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition cursor-pointer"
          >
            <option value="all">All difficulty</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>

          <select
            value={solved}
            onChange={(e) => onSolvedChange(e.target.value)}
            className="border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-2 text-xs sm:text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition cursor-pointer"
          >
            <option value="all">All status</option>
            <option value="solved">Solved</option>
            <option value="unsolved">Unsolved</option>
          </select>

          <button
            type="button"
            onClick={() => setTagsModalOpen(true)}
            className="px-3 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 hover:shadow-lg active:scale-95 text-white rounded-lg font-medium text-xs sm:text-sm transition-all whitespace-nowrap"
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

import React from "react";
import { Loader } from "../../Loader";
import { MovieHubYtLibraryItem } from "../../../apis/moviehub/moviehub";

type YtLibraryItemsTableProps = {
  ytLibraryLoading: boolean;
  ytLibraryItems: MovieHubYtLibraryItem[];
  deletingItemId: string | null;
  onRefreshItems: () => void;
  onDeleteItem: (itemId: string) => void;
};

export const YtLibraryItemsTable: React.FC<YtLibraryItemsTableProps> = React.memo(
  ({
    ytLibraryLoading,
    ytLibraryItems,
    deletingItemId,
    onRefreshItems,
    onDeleteItem,
  }) => {
    return (
      <div className="moviehub-section-card rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              Available YT Videos (Server)
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Lists videos currently available in the Jellyfin YT folder.
            </p>
          </div>
          <button
            onClick={onRefreshItems}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
          >
            Refresh
          </button>
        </div>

        {ytLibraryLoading ? (
          <Loader />
        ) : ytLibraryItems.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
            No YT videos found in the configured Jellyfin folder.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200/70 dark:border-slate-800/80 shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gradient-to-r from-slate-50 to-blue-50/60 dark:from-slate-900/70 dark:to-slate-800/50">
                <tr className="text-left text-slate-600 dark:text-slate-300">
                  <th className="py-3 px-4 font-semibold">Title</th>
                  <th className="py-3 px-4 font-semibold w-[140px] text-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {ytLibraryItems.map((item) => {
                  const itemId = item.Id || "";
                  const isDeleting = deletingItemId === itemId;
                  return (
                    <tr
                      key={itemId}
                      className="border-t border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50/70 dark:hover:bg-slate-900/30 transition-colors"
                    >
                      <td className="py-3 px-4 max-w-[560px] truncate font-medium">
                        {item.Name || "-"}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          disabled={isDeleting || !itemId}
                          onClick={() => onDeleteItem(itemId)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 disabled:opacity-60"
                        >
                          {isDeleting ? "Deleting..." : "Delete"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  },
);

YtLibraryItemsTable.displayName = "YtLibraryItemsTable";

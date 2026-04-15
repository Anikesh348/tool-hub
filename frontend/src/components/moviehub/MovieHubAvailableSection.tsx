import React, { useMemo, useState } from "react";
import { MovieHubAvailableMedia } from "../../apis/moviehub/moviehub";
import { Loader } from "../Loader";

type MovieHubAvailableSectionProps = {
  availableLoading: boolean;
  isAdmin: boolean;
  availableMediaType: "MOVIES" | "SHOWS";
  sortedAvailableItems: MovieHubAvailableMedia[];
  deletingMediaId: string | null;
  onSetMediaType: (type: "MOVIES" | "SHOWS") => void;
  onRefresh: () => void;
  onDelete: (item: MovieHubAvailableMedia) => void;
  formatDateTime: (value?: string) => string;
};

export const MovieHubAvailableSection: React.FC<MovieHubAvailableSectionProps> = React.memo(
  ({
    availableLoading,
    isAdmin,
    availableMediaType,
    sortedAvailableItems,
    deletingMediaId,
    onSetMediaType,
    onRefresh,
    onDelete,
    formatDateTime,
  }) => {
    const [searchQuery, setSearchQuery] = useState("");

    const filteredItems = useMemo(() => {
      const normalizedQuery = searchQuery.trim().toLowerCase();
      if (!normalizedQuery) return sortedAvailableItems;
      return sortedAvailableItems.filter((item) => {
        const title = (item.title || "").toLowerCase();
        const overview = (item.overview || "").toLowerCase();
        const path = (item.path || "").toLowerCase();
        const year = item.year ? String(item.year) : "";
        return (
          title.includes(normalizedQuery) ||
          overview.includes(normalizedQuery) ||
          path.includes(normalizedQuery) ||
          year.includes(normalizedQuery)
        );
      });
    }, [searchQuery, sortedAvailableItems]);

    return (
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Movies/Series Available
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              Browse media currently present on the server.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onSetMediaType("MOVIES")}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                availableMediaType === "MOVIES"
                  ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
              }`}
            >
              Movies
            </button>
            <button
              onClick={() => onSetMediaType("SHOWS")}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                availableMediaType === "SHOWS"
                  ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
              }`}
            >
              Shows
            </button>
            <button
              onClick={onRefresh}
              className="px-3 py-2 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 w-full sm:w-auto"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={`Search available ${availableMediaType === "MOVIES" ? "movies" : "shows"}...`}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white/90 dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => setSearchQuery("")}
            className="px-3 py-2 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 w-full sm:w-auto"
          >
            Clear
          </button>
        </div>

        {availableLoading ? (
          <Loader />
        ) : sortedAvailableItems.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-12">
            No available {availableMediaType === "MOVIES" ? "movies" : "shows"} found.
          </p>
        ) : filteredItems.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-12">
            No matches found for "{searchQuery.trim()}".
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredItems.map((item, idx) => (
              <div
                key={`${item.title}-${item.year || "na"}-${idx}`}
                className="moviehub-section-card rounded-xl p-4"
              >
                <div className="flex gap-4">
                  {item.poster ? (
                    <img
                      src={item.poster}
                      alt={item.title}
                      className="w-20 h-28 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                    />
                  ) : (
                    <div className="w-20 h-28 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center text-xs text-gray-400">
                      No Image
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-gray-900 dark:text-white line-clamp-1">
                      {item.title}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {item.mediaType === "MOVIES" ? "Movie" : "Show"}
                      {item.year ? ` • ${item.year}` : ""}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 line-clamp-3">
                      {item.overview || "No description available."}
                    </p>
                  </div>
                </div>

                <div className="mt-3 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                  {item.added ? <p>Added: {formatDateTime(item.added)}</p> : null}
                  {item.path ? <p className="break-all">Path: {item.path}</p> : null}
                  {item.mediaType === "SHOWS" ? (
                    <>
                      <p>
                        Episodes: {item.episodeFileCount || 0}/{item.totalEpisodeCount || 0}
                        {item.percentOfEpisodes !== undefined
                          ? ` (${Number(item.percentOfEpisodes).toFixed(1)}%)`
                          : ""}
                      </p>
                      <p>
                        Available seasons:{" "}
                        {item.availableSeasons && item.availableSeasons.length > 0
                          ? item.availableSeasons.join(", ")
                          : "-"}
                      </p>
                    </>
                  ) : null}
                </div>

                {isAdmin ? (
                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={() => onDelete(item)}
                      disabled={
                        deletingMediaId ===
                        `${item.mediaType}-${item.radarrId || item.sonarrId || idx}`
                      }
                      className="px-3 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {deletingMediaId ===
                      `${item.mediaType}-${item.radarrId || item.sonarrId || idx}`
                        ? "Deleting..."
                        : "Delete"}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
);

MovieHubAvailableSection.displayName = "MovieHubAvailableSection";

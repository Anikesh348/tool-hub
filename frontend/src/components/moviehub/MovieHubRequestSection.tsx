import React from "react";
import {
  MovieHubQuality,
  MovieHubSearchResult,
} from "../../apis/moviehub/moviehub";
import { Loader } from "../Loader";

type MovieHubRequestSectionProps = {
  isAdmin: boolean;
  mediaType: "MOVIES" | "SHOWS";
  query: string;
  results: MovieHubSearchResult[];
  qualityByResult: Record<string, MovieHubQuality>;
  seasonsByResult: Record<string, number[]>;
  activeRequestKey: string | null;
  searchLoading: boolean;
  createLoading: boolean;
  directDownloadLoading: boolean;
  isBusy: boolean;
  onMediaTypeChange: (type: "MOVIES" | "SHOWS") => void;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onClear: () => void;
  onQualityChange: (resultKey: string, quality: MovieHubQuality) => void;
  onToggleSeason: (resultKey: string, season: number) => void;
  onPlaceRequest: (result: MovieHubSearchResult) => void;
  getResultKey: (result: MovieHubSearchResult) => string;
};

const DEFAULT_QUALITY: MovieHubQuality = "any";

export const MovieHubRequestSection: React.FC<MovieHubRequestSectionProps> = React.memo(
  ({
    isAdmin,
    mediaType,
    query,
    results,
    qualityByResult,
    seasonsByResult,
    activeRequestKey,
    searchLoading,
    createLoading,
    directDownloadLoading,
    isBusy,
    onMediaTypeChange,
    onQueryChange,
    onSearch,
    onClear,
    onQualityChange,
    onToggleSeason,
    onPlaceRequest,
    getResultKey,
  }) => {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              {isAdmin ? "Start a Download" : "Request Media"}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              Search and pick the exact title, quality, and seasons.
            </p>
          </div>
        </div>

        <div className="moviehub-section-card p-3 sm:p-4 flex flex-col gap-3 mb-1">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onMediaTypeChange("MOVIES")}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                mediaType === "MOVIES"
                  ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
              }`}
            >
              Movies
            </button>
            <button
              onClick={() => onMediaTypeChange("SHOWS")}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                mediaType === "SHOWS"
                  ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
              }`}
            >
              Shows
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-2 min-w-0">
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              placeholder={`Search ${mediaType === "MOVIES" ? "movies" : "shows"}...`}
              className="w-full min-w-0 px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/70"
            />
            <button
              onClick={onSearch}
              disabled={searchLoading}
              className="px-5 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-blue-600 to-purple-600 text-white disabled:opacity-60 w-full sm:w-auto"
            >
              Search
            </button>
            <button
              onClick={onClear}
              disabled={searchLoading && results.length === 0}
              className="px-5 py-2 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-60 w-full sm:w-auto"
            >
              Clear
            </button>
          </div>
        </div>

        {searchLoading ? (
          <Loader />
        ) : results.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-12">
            {isAdmin
              ? "Search for a movie or show and start download directly."
              : "Search for a movie or show to request download."}
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {results.map((result, idx) => {
              const resultKey = getResultKey(result);
              const selectedQuality = qualityByResult[resultKey] || DEFAULT_QUALITY;
              const selectedSeasons = seasonsByResult[resultKey] || [];
              const isCurrentRequest =
                activeRequestKey === resultKey && (createLoading || directDownloadLoading);
              return (
                <div
                  key={`${resultKey}-${idx}`}
                  className="moviehub-section-card rounded-xl p-4"
                >
                  <div className="flex gap-4">
                    {result.poster ? (
                      <img
                        src={result.poster}
                        alt={result.title}
                        className="w-20 h-28 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                      />
                    ) : (
                      <div className="w-20 h-28 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center text-xs text-gray-400">
                        No Image
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-bold text-gray-900 dark:text-white line-clamp-1">
                        {result.title}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {result.mediaType === "MOVIES" ? "Movie" : "Series"}
                        {result.year ? ` • ${result.year}` : ""}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 line-clamp-3">
                        {result.overview || "No description available."}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                    <label className="text-sm text-gray-700 dark:text-gray-300">
                      Quality
                      <select
                        value={selectedQuality}
                        onChange={(e) => onQualityChange(resultKey, e.target.value as MovieHubQuality)}
                        className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-800 text-sm"
                      >
                        <option value="any">Any</option>
                        <option value="720p">720p</option>
                        <option value="1080p">1080p</option>
                        <option value="4k">4K</option>
                      </select>
                    </label>

                    <button
                      onClick={() => onPlaceRequest(result)}
                      disabled={isCurrentRequest || isBusy}
                      className="h-10 px-4 rounded-lg text-sm font-semibold bg-gradient-to-r from-blue-600 to-purple-600 text-white disabled:opacity-60"
                    >
                      {isCurrentRequest
                        ? isAdmin
                          ? "Starting Download..."
                          : "Requesting..."
                        : isAdmin
                          ? "Download Now"
                          : "Place Request"}
                    </button>
                  </div>

                  {result.mediaType === "SHOWS" && (
                    <div className="mt-3">
                      <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">
                        Select seasons
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {(result.seasonOptions || []).map((season) => {
                          const selected = selectedSeasons.includes(season);
                          return (
                            <button
                              key={season}
                              onClick={() => onToggleSeason(resultKey, season)}
                              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                                selected
                                  ? "bg-blue-600 border-blue-600 text-white"
                                  : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300"
                              }`}
                            >
                              Season {season}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }
);

MovieHubRequestSection.displayName = "MovieHubRequestSection";

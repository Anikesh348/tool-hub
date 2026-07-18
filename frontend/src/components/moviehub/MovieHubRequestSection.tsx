import React from "react";
import {
  MovieHubQuality,
  MovieHubSearchResult,
} from "../../apis/moviehub/moviehub";
import { Loader } from "../Loader";
import { MovieHubPagination, usePaginatedItems } from "./MovieHubPagination";
import { Download, Film, Search, Tv, X } from "lucide-react";

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
    const {
      currentPage,
      pageCount,
      pageSize,
      paginatedItems,
      setCurrentPage,
      setPageSize,
    } = usePaginatedItems(results, 6);

    return (
      <div className="space-y-7">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="moviehub-section-eyebrow">Discover</p>
            <h2 className="text-3xl font-bold text-white">
              Find your next watch
            </h2>
            <p className="mt-2 max-w-xl text-sm text-slate-400">
              Search movies and series, choose your quality, and add them to
              MovieHub.
            </p>
          </div>
        </div>

        <div className="moviehub-discovery-bar">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onMediaTypeChange("MOVIES")}
              className={`moviehub-filter-chip ${
                mediaType === "MOVIES"
                  ? "moviehub-filter-chip-active"
                  : ""
              }`}
            >
              <Film className="h-4 w-4" />
              Movies
            </button>
            <button
              onClick={() => onMediaTypeChange("SHOWS")}
              className={`moviehub-filter-chip ${
                mediaType === "SHOWS"
                  ? "moviehub-filter-chip-active"
                  : ""
              }`}
            >
              <Tv className="h-4 w-4" />
              Shows
            </button>
          </div>
          <div className="moviehub-discovery-search">
            <Search className="h-4 w-4 shrink-0 text-slate-500" />
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              placeholder={`Search ${mediaType === "MOVIES" ? "movies" : "shows"}...`}
            />
            <button
              onClick={onSearch}
              disabled={searchLoading}
              className="moviehub-play-button"
            >
              Search
            </button>
            <button
              onClick={onClear}
              disabled={searchLoading && results.length === 0}
              className="moviehub-icon-button"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
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
          <div className="space-y-4">
            <MovieHubPagination
              currentPage={currentPage}
              pageCount={pageCount}
              pageSize={pageSize}
              totalItems={results.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
            />
            <div className="moviehub-discovery-grid">
            {paginatedItems.map((result, idx) => {
              const resultKey = getResultKey(result);
              const selectedQuality = qualityByResult[resultKey] || DEFAULT_QUALITY;
              const selectedSeasons = seasonsByResult[resultKey] || [];
              const isCurrentRequest =
                activeRequestKey === resultKey && (createLoading || directDownloadLoading);
              return (
                <div
                  key={`${resultKey}-${idx}`}
                  className="moviehub-discovery-card"
                >
                  <div className="moviehub-discovery-art">
                    {result.poster ? (
                      <img
                        src={result.poster}
                        alt={result.title}
                      />
                    ) : (
                      <div className="moviehub-poster-placeholder">
                        MovieHub
                      </div>
                    )}
                    <span className="moviehub-poster-type">
                      {result.mediaType === "MOVIES" ? "Movie" : "Series"}
                    </span>
                  </div>

                  <div className="moviehub-discovery-copy">
                    <h3>{result.title}</h3>
                    <p>{result.year || "Coming to MovieHub"}</p>
                    <span>
                      {result.overview || "No description available."}
                    </span>
                  </div>

                  <div className="moviehub-discovery-actions">
                    <label>
                      <select
                        value={selectedQuality}
                        onChange={(e) => onQualityChange(resultKey, e.target.value as MovieHubQuality)}
                        aria-label={`Quality for ${result.title}`}
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
                      className="moviehub-request-button"
                    >
                      <Download className="h-4 w-4" />
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
                    <div className="moviehub-season-picker">
                      <p>
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
            <MovieHubPagination
              currentPage={currentPage}
              pageCount={pageCount}
              pageSize={pageSize}
              totalItems={results.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        )}
      </div>
    );
  }
);

MovieHubRequestSection.displayName = "MovieHubRequestSection";

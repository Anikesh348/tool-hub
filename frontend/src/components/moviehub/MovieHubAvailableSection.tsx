import React, { useMemo, useState } from "react";
import { MovieHubAvailableMedia } from "../../apis/moviehub/moviehub";
import { Loader } from "../Loader";
import { MovieHubPagination, usePaginatedItems } from "./MovieHubPagination";
import {
  LoaderCircle,
  Play,
  Search,
  Trash2,
} from "lucide-react";

type MovieHubAvailableSectionProps = {
  availableLoading: boolean;
  isAdmin: boolean;
  availableMediaType: "MOVIES" | "SHOWS";
  sortedAvailableItems: MovieHubAvailableMedia[];
  deletingMediaId: string | null;
  onSetMediaType: (type: "MOVIES" | "SHOWS") => void;
  onRefresh: () => void;
  onDelete: (item: MovieHubAvailableMedia, season?: number) => void;
  formatDateTime: (value?: string) => string;
  onWatch: (item: MovieHubAvailableMedia) => void;
  playingMediaTitle: string | null;
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
    onWatch,
    playingMediaTitle,
  }) => {
    const [searchQuery, setSearchQuery] = useState("");
    const [seasonToDeleteByItemKey, setSeasonToDeleteByItemKey] = useState<
      Record<string, string>
    >({});

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

    const {
      currentPage,
      pageCount,
      pageSize,
      paginatedItems,
      setCurrentPage,
      setPageSize,
    } = usePaginatedItems(filteredItems, 6);

    const getItemKey = (item: MovieHubAvailableMedia, index: number) =>
      `${item.mediaType}-${item.radarrId || item.sonarrId || item.title}-${index}`;

    return (
      <div className="space-y-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="moviehub-section-eyebrow">Explore</p>
            <h2 className="text-2xl font-bold text-white">
              {availableMediaType === "MOVIES"
                ? "Movies in your library"
                : "Series in your library"}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onSetMediaType("MOVIES")}
              className={`moviehub-filter-chip ${
                availableMediaType === "MOVIES"
                  ? "moviehub-filter-chip-active"
                  : ""
              }`}
            >
              Movies
            </button>
            <button
              onClick={() => onSetMediaType("SHOWS")}
              className={`moviehub-filter-chip ${
                availableMediaType === "SHOWS"
                  ? "moviehub-filter-chip-active"
                  : ""
              }`}
            >
              Shows
            </button>
            <button
              onClick={onRefresh}
              className="moviehub-filter-chip"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="moviehub-library-search">
          <Search className="h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={`Search ${availableMediaType === "MOVIES" ? "movies" : "series"}...`}
          />
          <button
            onClick={() => setSearchQuery("")}
            className="moviehub-filter-chip"
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
          <div className="space-y-4">
            <MovieHubPagination
              currentPage={currentPage}
              pageCount={pageCount}
              pageSize={pageSize}
              totalItems={filteredItems.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
            />
            <div className="moviehub-poster-grid">
            {paginatedItems.map((item, idx) => {
              const itemKey = getItemKey(item, idx);
              const selectedSeasonValue = seasonToDeleteByItemKey[itemKey] || "";
              const selectedSeason = selectedSeasonValue
                ? Number(selectedSeasonValue)
                : undefined;
              const deleteKey =
                selectedSeason && item.mediaType === "SHOWS"
                  ? `${item.mediaType}-${item.sonarrId || idx}-S${selectedSeason}`
                  : `${item.mediaType}-${item.radarrId || item.sonarrId || idx}`;
              const availableSeasons = item.availableSeasons || [];

              return (
                <div
                  key={`${item.title}-${item.year || "na"}-${idx}`}
                  className="moviehub-poster-card group"
                >
                  <div className="moviehub-poster-art">
                    {item.poster ? (
                      <img src={item.poster} alt={item.title} />
                    ) : (
                      <div className="moviehub-poster-placeholder">MovieHub</div>
                    )}
                    <div className="moviehub-poster-overlay">
                      <button
                        onClick={() => onWatch(item)}
                        disabled={playingMediaTitle === item.title}
                        className="moviehub-poster-play"
                        aria-label={`Watch ${item.title}`}
                      >
                        {playingMediaTitle === item.title ? (
                          <LoaderCircle className="h-5 w-5 animate-spin" />
                        ) : (
                          <Play className="h-5 w-5 fill-current" />
                        )}
                      </button>
                    </div>
                    <span className="moviehub-poster-type">
                      {item.mediaType === "MOVIES" ? "Movie" : "Series"}
                    </span>
                  </div>
                  <div className="moviehub-poster-copy">
                    <h3>{item.title}</h3>
                    <p>
                      {item.year || "MovieHub"}
                      {item.mediaType === "SHOWS" && item.availableSeasons?.length
                        ? ` · ${item.availableSeasons.length} season${
                            item.availableSeasons.length === 1 ? "" : "s"
                          }`
                        : ""}
                    </p>
                    <span>{item.overview || "Available to stream."}</span>
                  </div>

                  {isAdmin ? (
                    <div className="moviehub-poster-admin">
                      {item.mediaType === "SHOWS" && availableSeasons.length > 0 ? (
                        <select
                          value={selectedSeasonValue}
                          onChange={(event) =>
                            setSeasonToDeleteByItemKey((current) => ({
                              ...current,
                              [itemKey]: event.target.value,
                            }))
                          }
                          aria-label={`Delete scope for ${item.title}`}
                        >
                          <option value="">Entire show</option>
                          {availableSeasons.map((season) => (
                            <option key={season} value={season}>
                              Season {season}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-[10px] text-slate-600">
                          Added {item.added ? formatDateTime(item.added) : "to library"}
                        </span>
                      )}
                      <button
                        onClick={() => onDelete(item, selectedSeason)}
                        disabled={deletingMediaId === deleteKey}
                        aria-label={`Delete ${item.title}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deletingMediaId === deleteKey ? "Deleting" : "Delete"}
                      </button>
                    </div>
                  ) : null}
              </div>
              );
            })}
            </div>
            <MovieHubPagination
              currentPage={currentPage}
              pageCount={pageCount}
              pageSize={pageSize}
              totalItems={filteredItems.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        )}
      </div>
    );
  }
);

MovieHubAvailableSection.displayName = "MovieHubAvailableSection";

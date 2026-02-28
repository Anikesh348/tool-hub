import React from "react";
import {
  MovieHubCompletedDownloadItem,
  MovieHubDownloadItem,
  MovieHubDownloadScope,
} from "../../apis/moviehub/moviehub";
import { Loader } from "../Loader";

type MovieHubDownloadingSectionProps = {
  downloadsLoading: boolean;
  isAdmin: boolean;
  downloadScope: MovieHubDownloadScope;
  downloadItems: MovieHubDownloadItem[];
  completedDownloadItems: MovieHubCompletedDownloadItem[];
  onSetDownloadScope: (scope: MovieHubDownloadScope) => void;
  onRefresh: () => void;
  formatDateTime: (value?: string) => string;
};

export const MovieHubDownloadingSection: React.FC<MovieHubDownloadingSectionProps> = React.memo(
  ({
    downloadsLoading,
    isAdmin,
    downloadScope,
    downloadItems,
    completedDownloadItems,
    onSetDownloadScope,
    onRefresh,
    formatDateTime,
  }) => {
    return (
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Downloading Status</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              View active queue progress and completed downloads.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <>
                <button
                  onClick={() => onSetDownloadScope("mine")}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                    downloadScope === "mine"
                      ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                  }`}
                >
                  My Requests
                </button>
                <button
                  onClick={() => onSetDownloadScope("all")}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                    downloadScope === "all"
                      ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                  }`}
                >
                  All Downloads
                </button>
              </>
            )}
            <button
              onClick={onRefresh}
              className="px-3 py-2 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 w-full sm:w-auto"
            >
              Refresh
            </button>
          </div>
        </div>

        {downloadsLoading ? (
          <Loader />
        ) : downloadItems.length === 0 && completedDownloadItems.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-12">
            No active or completed downloads found for this scope.
          </p>
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Active Downloads ({downloadItems.length})
              </h3>
              {downloadItems.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-3">
                  No active downloads in queue.
                </p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {downloadItems.map((item, idx) => {
                    const progress = Number(item.progressPercent || 0);
                    const displayProgress = Number.isFinite(progress) ? progress : 0;
                    const key = item.downloadId || String(item.queueItemId || idx);
                    return (
                      <div
                        key={key}
                        className="moviehub-section-card rounded-xl p-4 min-w-0"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="text-base font-bold text-gray-900 dark:text-white truncate">
                              {item.title}
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {item.mediaType === "MOVIES" ? "Movie" : "Series"}
                              {item.trackedDownloadState ? ` • ${item.trackedDownloadState}` : ""}
                            </p>
                          </div>
                          {item.status && (
                            <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                              {item.status}
                            </span>
                          )}
                        </div>

                        <div className="mt-3">
                          <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-blue-600 to-purple-600 transition-all duration-300"
                              style={{ width: `${Math.max(0, Math.min(100, displayProgress))}%` }}
                            />
                          </div>
                          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                            Progress: {displayProgress.toFixed(1)}%
                          </p>
                        </div>

                        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                          {item.mediaType === "SHOWS" && item.seasonNumbers?.length ? (
                            <p>Seasons: {item.seasonNumbers.join(", ")}</p>
                          ) : null}
                          {item.mediaType === "SHOWS" && item.episodeCount ? (
                            <p>Episodes in queue: {item.episodeCount}</p>
                          ) : null}
                          {item.timeleft ? <p>Time left: {item.timeleft}</p> : null}
                          {item.estimatedCompletionTime ? (
                            <p>ETA: {formatDateTime(item.estimatedCompletionTime)}</p>
                          ) : null}
                          {item.downloadClient ? <p>Client: {item.downloadClient}</p> : null}
                          {item.indexer ? <p>Indexer: {item.indexer}</p> : null}
                          {item.added ? <p>Added: {formatDateTime(item.added)}</p> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Completed Downloads ({completedDownloadItems.length})
              </h3>
              {completedDownloadItems.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-3">
                  No completed downloads found.
                </p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {completedDownloadItems.map((item) => (
                    <div
                      key={item.requestId}
                      className="rounded-xl p-4 min-w-0 border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/20"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="text-base font-bold text-gray-900 dark:text-white truncate">
                            {item.title}
                          </h4>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {item.mediaType === "MOVIES" ? "Movie" : "Series"}
                          </p>
                        </div>
                        <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                          {item.status || "DOWNLOADED"}
                        </span>
                      </div>

                      <div className="mt-3 text-xs text-gray-600 dark:text-gray-300 space-y-1">
                        {item.season?.length ? <p>Seasons: {item.season.join(", ")}</p> : null}
                        {item.qualityProfileId ? <p>Quality: {item.qualityProfileId}</p> : null}
                        {item.downloadedAt ? (
                          <p>Downloaded: {formatDateTime(item.downloadedAt)}</p>
                        ) : null}
                        {item.approvedAt ? <p>Approved: {formatDateTime(item.approvedAt)}</p> : null}
                        {item.createdAt ? <p>Requested: {formatDateTime(item.createdAt)}</p> : null}
                        {isAdmin && downloadScope === "all" && item.requestedBy ? (
                          <p>
                            Requested by:{" "}
                            {item.requestedBy.userName || item.requestedBy.userEmail || "Unknown"}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);

MovieHubDownloadingSection.displayName = "MovieHubDownloadingSection";

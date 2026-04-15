import React from "react";
import {
  MovieHubCompletedDownloadItem,
  MovieHubDownloadHandlingState,
  MovieHubDownloadItem,
  MovieHubDownloadScope,
} from "../../apis/moviehub/moviehub";
import { Loader } from "../Loader";

type MovieHubDownloadingSectionProps = {
  downloadsLoading: boolean;
  isAdmin: boolean;
  downloadScope: MovieHubDownloadScope;
  downloadHandling: MovieHubDownloadHandlingState | null;
  downloadControlLoading: boolean;
  deletingQueueItemKey: string | null;
  downloadItems: MovieHubDownloadItem[];
  completedDownloadItems: MovieHubCompletedDownloadItem[];
  onSetDownloadScope: (scope: MovieHubDownloadScope) => void;
  onRefresh: () => void;
  onPause: () => void;
  onResume: () => void;
  onDeleteDownload: (item: MovieHubDownloadItem) => void;
  formatDateTime: (value?: string) => string;
};

export const MovieHubDownloadingSection: React.FC<MovieHubDownloadingSectionProps> = React.memo(
  ({
    downloadsLoading,
    isAdmin,
    downloadScope,
    downloadHandling,
    downloadControlLoading,
    deletingQueueItemKey,
    downloadItems,
    completedDownloadItems,
    onSetDownloadScope,
    onRefresh,
    onPause,
    onResume,
    onDeleteDownload,
    formatDateTime,
  }) => {
    const isPaused = Boolean(downloadHandling?.paused);
    const isPartiallyPaused = Boolean(downloadHandling?.partiallyPaused);

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
            {isAdmin ? (
              <button
                onClick={isPaused ? onResume : onPause}
                disabled={downloadControlLoading}
                className="px-3 py-2 rounded-lg text-sm font-semibold bg-amber-500 text-slate-950 disabled:opacity-60 disabled:cursor-not-allowed w-full sm:w-auto"
              >
                {downloadControlLoading
                  ? isPaused
                    ? "Resuming..."
                    : "Pausing..."
                  : isPaused
                    ? "Resume Downloads"
                    : "Pause Downloads"}
              </button>
            ) : null}
          </div>
        </div>

        {isAdmin && downloadHandling?.statusKnown ? (
          <div className="rounded-xl border border-amber-200/70 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
            {isPartiallyPaused
              ? "Download automation is partially paused across Radarr/Sonarr."
              : isPaused
                ? "Download automation is paused across Radarr and Sonarr."
                : "Download automation is active across Radarr and Sonarr."}
          </div>
        ) : null}

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
                    const deleteKey = `${item.mediaType}-${String(item.queueItemId || key)}`;
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

                        {isAdmin && item.queueItemId !== undefined ? (
                          <div className="mt-4 flex justify-end">
                            <button
                              onClick={() => onDeleteDownload(item)}
                              disabled={deletingQueueItemKey === deleteKey}
                              className="px-3 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {deletingQueueItemKey === deleteKey ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        ) : null}
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
                <div className="overflow-hidden rounded-2xl border border-slate-200/70 dark:border-slate-800/80 shadow-sm">
                  <table className="w-full text-sm">
                    <thead className="bg-gradient-to-r from-emerald-50 to-blue-50/60 dark:from-emerald-950/30 dark:to-slate-800/40">
                      <tr className="text-left text-slate-600 dark:text-slate-300">
                        <th className="py-3 px-4 font-semibold">Title</th>
                        <th className="py-3 px-4 font-semibold">Type</th>
                        <th className="py-3 px-4 font-semibold">Quality</th>
                        <th className="py-3 px-4 font-semibold">Downloaded</th>
                        <th className="py-3 px-4 font-semibold">Status</th>
                        {isAdmin && downloadScope === "all" ? (
                          <th className="py-3 px-4 font-semibold">Requested By</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {completedDownloadItems.map((item) => {
                        const requestedBy =
                          item.requestedBy?.userName ||
                          item.requestedBy?.userEmail ||
                          "Unknown";
                        return (
                          <tr
                            key={item.requestId}
                            className="border-t border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50/70 dark:hover:bg-slate-900/30 transition-colors"
                          >
                            <td className="py-3 px-4 min-w-[240px] max-w-[420px]">
                              <p className="font-semibold truncate">{item.title}</p>
                              {item.season?.length ? (
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                  Seasons: {item.season.join(", ")}
                                </p>
                              ) : null}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              {item.mediaType === "MOVIES" ? "Movie" : "Series"}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              {item.qualityProfileId || "-"}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              {formatDateTime(item.downloadedAt)}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                {item.status || "DOWNLOADED"}
                              </span>
                            </td>
                            {isAdmin && downloadScope === "all" ? (
                              <td className="py-3 px-4 max-w-[260px] truncate">
                                {requestedBy}
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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

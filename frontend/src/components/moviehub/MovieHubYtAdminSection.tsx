import React from "react";
import {
  MovieHubYtFormatItem,
  MovieHubYtFormatsResponse,
  MovieHubYtRequestFormat,
} from "../../apis/moviehub/moviehub";
import { Loader } from "../Loader";

export type YtSseProgressEvent = {
  event: string;
  payload: Record<string, unknown> | null;
  receivedAt: string;
};

type MovieHubYtAdminSectionProps = {
  ytUrl: string;
  filename: string;
  formatsLoading: boolean;
  downloadInProgress: boolean;
  formatsResponse: MovieHubYtFormatsResponse | null;
  selectedFormat: MovieHubYtRequestFormat | null;
  latestProgressEvent: YtSseProgressEvent | null;
  downloadError: string | null;
  onYtUrlChange: (value: string) => void;
  onFilenameChange: (value: string) => void;
  onFetchFormats: () => void;
  onClearSearch: () => void;
  onFormatChange: (format: MovieHubYtRequestFormat) => void;
  onDownloadToServer: () => void;
  onCancelDownload: () => void;
};

const getRequestFormat = (format: MovieHubYtFormatItem): MovieHubYtRequestFormat => {
  return {
    quality: format.request_format?.quality || format.quality,
    ext: format.request_format?.ext || format.ext || "mp4",
  };
};

const formatDuration = (duration?: number) => {
  if (!duration || duration < 0) return "-";
  const mins = Math.floor(duration / 60);
  const secs = duration % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
};

const asString = (value: unknown) => (typeof value === "string" ? value : "");

const asNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

export const MovieHubYtAdminSection: React.FC<MovieHubYtAdminSectionProps> = React.memo(
  ({
    ytUrl,
    filename,
    formatsLoading,
    downloadInProgress,
    formatsResponse,
    selectedFormat,
    latestProgressEvent,
    downloadError,
    onYtUrlChange,
    onFilenameChange,
    onFetchFormats,
    onClearSearch,
    onFormatChange,
    onDownloadToServer,
    onCancelDownload,
  }) => {
    const formats = formatsResponse?.formats || [];
    const selectedFormatValue = selectedFormat
      ? `${selectedFormat.quality}::${selectedFormat.ext || "mp4"}`
      : "";
    const latestPayload = latestProgressEvent?.payload || null;
    const progressPercent = asNumber(latestPayload?.progress_percent);
    const progressWidth = `${Math.max(0, Math.min(100, progressPercent ?? 0))}%`;

    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Download YT Video to Server
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            Paste a YouTube URL, pick format, and start server-side download.
          </p>
        </div>

        <div className="moviehub-section-card rounded-xl p-4 space-y-3">
          <label className="block text-sm text-gray-700 dark:text-gray-300">
            YouTube URL
            <input
              value={ytUrl}
              onChange={(e) => onYtUrlChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onFetchFormats()}
              placeholder="https://www.youtube.com/watch?v=..."
              className="mt-1 w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/70"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onFetchFormats}
              disabled={formatsLoading || !ytUrl.trim()}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-blue-600 to-purple-600 text-white disabled:opacity-60"
            >
              {formatsLoading ? "Fetching..." : "Get Formats"}
            </button>
            <button
              onClick={onClearSearch}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
            >
              Clear
            </button>
          </div>
        </div>

        {formatsLoading ? (
          <Loader />
        ) : formatsResponse ? (
          <div className="moviehub-section-card rounded-xl p-4 space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              {formatsResponse.thumbnail ? (
                <img
                  src={formatsResponse.thumbnail}
                  alt={formatsResponse.title || "YT thumbnail"}
                  className="w-32 h-20 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                />
              ) : null}
              <div className="min-w-0">
                <p className="text-base font-semibold text-gray-900 dark:text-white break-words">
                  {formatsResponse.title || "Untitled"}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  Uploader: {formatsResponse.uploader || "-"} • Duration:{" "}
                  {formatDuration(formatsResponse.duration)}
                </p>
              </div>
            </div>

            {formats.length > 0 ? (
              <>
                <label className="block text-sm text-gray-700 dark:text-gray-300">
                  Select format
                  <select
                    value={selectedFormatValue}
                    onChange={(e) => {
                      const [quality, ext] = e.target.value.split("::");
                      if (!quality) return;
                      onFormatChange({ quality, ext: ext || "mp4" });
                    }}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-800 text-sm text-gray-900 dark:text-white"
                  >
                    {formats.map((format, idx) => {
                      const requestFormat = getRequestFormat(format);
                      const value = `${requestFormat.quality}::${requestFormat.ext || "mp4"}`;
                      return (
                        <option key={`${value}-${idx}`} value={value}>
                          {format.label || requestFormat.quality} ({requestFormat.ext || "mp4"})
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label className="block text-sm text-gray-700 dark:text-gray-300">
                  Filename (optional)
                  <input
                    value={filename}
                    onChange={(e) => onFilenameChange(e.target.value)}
                    placeholder="Leave empty to use video title"
                    className="mt-1 w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/70"
                  />
                </label>

                <div>
                  <button
                    onClick={onDownloadToServer}
                    disabled={downloadInProgress || !selectedFormat}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-emerald-600 to-green-600 text-white disabled:opacity-60"
                  >
                    {downloadInProgress ? "Downloading..." : "Download to Server"}
                  </button>
                  {downloadInProgress && (
                    <button
                      onClick={onCancelDownload}
                      className="ml-2 px-4 py-2 rounded-lg text-sm font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No compatible formats returned for this URL.
              </p>
            )}
          </div>
        ) : null}

        {latestProgressEvent ? (
          <div className="moviehub-section-card rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                Live Progress ({latestProgressEvent.event})
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {new Date(latestProgressEvent.receivedAt).toLocaleTimeString()}
              </p>
            </div>
            {progressPercent !== null ? (
              <div className="space-y-1">
                <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-blue-600 to-emerald-500 transition-all duration-300"
                    style={{ width: progressWidth }}
                  />
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  {progressPercent.toFixed(1)}%
                </p>
              </div>
            ) : null}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-700 dark:text-gray-300">
              <p>Status: {asString(latestPayload?.status) || "-"}</p>
              <p>Phase: {asString(latestPayload?.phase) || "-"}</p>
              <p>Speed: {asString(latestPayload?.speed) || "-"}</p>
              <p>ETA: {asString(latestPayload?.eta) || "-"}</p>
              <p className="sm:col-span-2 break-words">
                File: {asString(latestPayload?.filename) || "-"}
              </p>
            </div>
          </div>
        ) : null}

        {downloadError ? (
          <div className="moviehub-section-card rounded-xl p-4">
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">
              {downloadError}
            </p>
          </div>
        ) : null}
      </div>
    );
  },
);

MovieHubYtAdminSection.displayName = "MovieHubYtAdminSection";

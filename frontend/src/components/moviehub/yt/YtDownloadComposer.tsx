import React from "react";
import {
  MovieHubYtFormatItem,
  MovieHubYtFormatsResponse,
  MovieHubYtRequestFormat,
} from "../../../apis/moviehub/moviehub";
import { Loader } from "../../Loader";

type YtDownloadComposerProps = {
  ytUrl: string;
  filename: string;
  formatsLoading: boolean;
  downloadInProgress: boolean;
  formatsResponse: MovieHubYtFormatsResponse | null;
  selectedFormat: MovieHubYtRequestFormat | null;
  downloadError: string | null;
  onYtUrlChange: (value: string) => void;
  onFilenameChange: (value: string) => void;
  onFetchFormats: () => void;
  onClearSearch: () => void;
  onFormatChange: (format: MovieHubYtRequestFormat) => void;
  onDownloadToServer: () => void;
};

const getRequestFormat = (
  format: MovieHubYtFormatItem,
): MovieHubYtRequestFormat => {
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

export const YtDownloadComposer: React.FC<YtDownloadComposerProps> = React.memo(
  ({
    ytUrl,
    filename,
    formatsLoading,
    downloadInProgress,
    formatsResponse,
    selectedFormat,
    downloadError,
    onYtUrlChange,
    onFilenameChange,
    onFetchFormats,
    onClearSearch,
    onFormatChange,
    onDownloadToServer,
  }) => {
    const formats = formatsResponse?.formats || [];
    const selectedFormatValue = selectedFormat
      ? `${selectedFormat.quality}::${selectedFormat.ext || "mp4"}`
      : "";

    return (
      <div className="space-y-4">
        <div className="moviehub-section-card rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              1. Search Format
            </h3>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Selected format will be downloaded to the MovieHub server after queueing.
          </p>
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
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 text-white disabled:opacity-60"
            >
              {formatsLoading ? "Fetching..." : "Get Formats"}
            </button>
            <button
              onClick={onClearSearch}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
            >
              Reset
            </button>
          </div>
        </div>

        {formatsLoading ? (
          <div className="moviehub-section-card rounded-xl p-4 sm:p-5">
            <Loader />
          </div>
        ) : null}

        {formatsResponse ? (
          <div className="moviehub-section-card rounded-xl p-4 sm:p-5 space-y-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              2. Queue Download
            </h3>
            <div className="flex flex-col sm:flex-row gap-4">
              {formatsResponse.thumbnail ? (
                <img
                  src={formatsResponse.thumbnail}
                  alt={formatsResponse.title || "YT thumbnail"}
                  className="w-40 h-24 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
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
                  Format
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
                          {format.label || requestFormat.quality} (
                          {requestFormat.ext || "mp4"})
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

                <div className="pt-1">
                  <button
                    onClick={onDownloadToServer}
                    disabled={downloadInProgress || !selectedFormat}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-emerald-600 to-green-600 text-white disabled:opacity-60"
                  >
                    {downloadInProgress ? "Submitting..." : "Add & Start (MovieHub Server)"}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No compatible formats returned for this URL.
              </p>
            )}
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

YtDownloadComposer.displayName = "YtDownloadComposer";

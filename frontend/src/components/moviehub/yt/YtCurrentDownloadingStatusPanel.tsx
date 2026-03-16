import React, { useMemo } from "react";
import { MovieHubYtDownloadRequest } from "../../../apis/moviehub/moviehub";

type YtCurrentDownloadingStatusPanelProps = {
  ytRequests: MovieHubYtDownloadRequest[];
  ytStatusByVideoId: Record<string, Record<string, unknown>>;
  formatDateTime: (value?: string) => string;
};

const readString = (value: unknown) => {
  return typeof value === "string" ? value : undefined;
};

const readNumber = (value: unknown) => {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const normalizeTimestampToMs = (value: unknown) => {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  if (raw > 1e15) return Math.floor(raw / 1e6); // nanos -> millis
  if (raw > 1e12) return Math.floor(raw); // millis
  if (raw > 1e9) return Math.floor(raw * 1000); // seconds -> millis
  return undefined;
};

export const YtCurrentDownloadingStatusPanel: React.FC<
  YtCurrentDownloadingStatusPanelProps
> = React.memo(({ ytRequests, ytStatusByVideoId, formatDateTime }) => {
  const downloadingRequests = useMemo(
    () =>
      ytRequests.filter(
        (request) =>
          request.status?.toUpperCase() === "DOWNLOADING" &&
          Boolean(request.videoId),
      ),
    [ytRequests],
  );

  return (
    <div className="moviehub-section-card rounded-xl p-3 sm:p-4 space-y-3 xl:sticky xl:top-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
          Current Downloading Status
        </h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Real-time snapshot for videos currently downloading to the MovieHub server.
        </p>
      </div>

      {downloadingRequests.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
          No active downloads right now.
        </p>
      ) : (
        <div className="space-y-3">
          {downloadingRequests.map((request) => {
            const status = ytStatusByVideoId[request.videoId] || {};
            const statusLabel =
              readString(status.status)?.toUpperCase() ||
              request.status?.toUpperCase() ||
              "DOWNLOADING";
            const phase = readString(status.phase) || "downloading";
            const progressPercent = Math.max(
              0,
              Math.min(100, readNumber(status.progress_percent) || 0),
            );
            const eta = readString(status.eta);
            const speed = readString(status.speed);
            const totalSize = readString(status.total_size);
            const updatedAtMs = normalizeTimestampToMs(status.updated_at);
            const updatedAt = updatedAtMs
              ? formatDateTime(new Date(updatedAtMs).toISOString())
              : formatDateTime(request.updatedAt);
            const displayTitle =
              request.title ||
              readString(status.filename) ||
              request.filename ||
              request.videoId;

            return (
              <div
                key={request.requestId}
                className="rounded-lg border border-gray-200 dark:border-gray-800 p-2.5 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white break-words">
                    {displayTitle}
                  </p>
                  <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    {statusLabel}
                  </span>
                </div>

                <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                <div className="text-xs text-gray-600 dark:text-gray-300 grid grid-cols-2 gap-x-3 gap-y-1">
                  <p>Progress: {progressPercent.toFixed(1)}%</p>
                  <p>Phase: {phase}</p>
                  <p>ETA: {eta || "-"}</p>
                  <p>Speed: {speed || "-"}</p>
                  <p>Size: {totalSize || "-"}</p>
                  <p>Updated: {updatedAt || "-"}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

YtCurrentDownloadingStatusPanel.displayName = "YtCurrentDownloadingStatusPanel";

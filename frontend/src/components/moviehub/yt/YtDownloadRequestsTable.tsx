import React, { useMemo } from "react";
import { MovieHubYtDownloadRequest } from "../../../apis/moviehub/moviehub";
import { Loader } from "../../Loader";

type YtDownloadRequestsTableProps = {
  ytRequestsLoading: boolean;
  ytRequests: MovieHubYtDownloadRequest[];
  formatDateTime: (value?: string) => string;
  onRefreshRequests: () => void;
};

const statusClass = (status: string) => {
  const normalized = status.toUpperCase();
  if (normalized === "DOWNLOADED") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
  }
  if (normalized === "DOWNLOADING") {
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
  }
  if (normalized === "FAILED") {
    return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
  }
  return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
};

export const YtDownloadRequestsTable: React.FC<YtDownloadRequestsTableProps> =
  React.memo(
    ({
      ytRequestsLoading,
      ytRequests,
      formatDateTime,
      onRefreshRequests,
    }) => {
      const counts = useMemo(() => {
        return ytRequests.reduce(
          (acc, request) => {
            const status = (request.status || "UNKNOWN").toUpperCase();
            acc.total += 1;
            if (status === "REQUESTED") acc.requested += 1;
            if (status === "DOWNLOADING") acc.downloading += 1;
            if (status === "DOWNLOADED") acc.downloaded += 1;
            if (status === "FAILED") acc.failed += 1;
            return acc;
          },
          {
            total: 0,
            requested: 0,
            downloading: 0,
            downloaded: 0,
            failed: 0,
          },
        );
      }, [ytRequests]);

      return (
        <div className="moviehub-section-card rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                Request Tracker
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                  Total: {counts.total}
                </span>
                <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  Requested: {counts.requested}
                </span>
                <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  Downloading: {counts.downloading}
                </span>
                <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  Downloaded: {counts.downloaded}
                </span>
                <span className="px-2 py-1 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  Failed: {counts.failed}
                </span>
              </div>
            </div>
            <button
              onClick={onRefreshRequests}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
            >
              Refresh
            </button>
          </div>

          {ytRequestsLoading ? (
            <Loader />
          ) : ytRequests.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
              No YT download requests found.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/40">
                  <tr className="text-left text-gray-500 dark:text-gray-400">
                    <th className="py-2 px-3">Title</th>
                    <th className="py-2 px-3">Format</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3">Created At</th>
                    <th className="py-2 px-3">Requested By</th>
                  </tr>
                </thead>
                <tbody>
                  {ytRequests.map((request) => {
                    const requestStatus = request.status || "UNKNOWN";
                    const requestedBy = request.userEmail || request.userId || "-";

                    return (
                      <tr
                        key={request.requestId}
                        className="border-t border-gray-100 dark:border-gray-800 text-gray-700 dark:text-gray-300"
                      >
                        <td className="py-2 px-3 max-w-[320px] truncate">
                          {request.title || request.filename || "-"}
                        </td>
                        <td className="py-2 px-3">
                          {request.format?.quality || "-"}
                          {request.format?.ext ? ` / ${request.format.ext}` : ""}
                        </td>
                        <td className="py-2 px-3 min-w-[190px]">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-semibold ${statusClass(
                              requestStatus,
                            )}`}
                          >
                            {requestStatus.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          {formatDateTime(request.createdAt)}
                        </td>
                        <td className="py-2 px-3 break-all">{requestedBy}</td>
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

YtDownloadRequestsTable.displayName = "YtDownloadRequestsTable";

import React from "react";
import { MovieHubRequest } from "../../apis/moviehub/moviehub";
import { Loader } from "../Loader";

type MovieHubAdminSectionProps = {
  adminRequestsLoading: boolean;
  approveLoading: boolean;
  deleteLoading: boolean;
  approvingRequestId: string | null;
  deletingRequestId: string | null;
  sortedAdminRequests: MovieHubRequest[];
  onRefresh: () => void;
  onApprove: (requestId: string) => void;
  onDelete: (requestId: string) => void;
  formatDateTime: (value?: string) => string;
};

export const MovieHubAdminSection: React.FC<MovieHubAdminSectionProps> = React.memo(
  ({
    adminRequestsLoading,
    approveLoading,
    deleteLoading,
    approvingRequestId,
    deletingRequestId,
    sortedAdminRequests,
    onRefresh,
    onApprove,
    onDelete,
    formatDateTime,
  }) => {
    const pendingCount = sortedAdminRequests.filter((request) => request.status === "PENDING").length;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Approve Requests</h2>
              {pendingCount > 0 && (
                <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500 text-white">
                  {pendingCount} pending
                </span>
              )}
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              Review pending requests and trigger downloads.
            </p>
          </div>
          <button
            onClick={onRefresh}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
          >
            Refresh
          </button>
        </div>

        {adminRequestsLoading ? (
          <Loader />
        ) : sortedAdminRequests.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-12">
            No user requests found.
          </p>
        ) : (
          <div className="space-y-3">
            {sortedAdminRequests.map((request) => {
              const isPending = request.status === "PENDING";
              const isApproved = request.status === "APPROVED";
              const canDelete = isPending || isApproved;
              const isApproving = approveLoading && approvingRequestId === request.requestId;
              const isDeleting = deleteLoading && deletingRequestId === request.requestId;
              return (
                <div
                  key={request.requestId}
                  className="moviehub-section-card rounded-xl p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-gray-900 dark:text-white">{request.title}</h3>
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                        request.status === "DOWNLOADED"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                          : request.status === "APPROVED"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                          : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
                      }`}
                    >
                      {request.status}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300 break-all">
                    Requested by: {request.userName || "-"} ({request.userEmail || "-"})
                  </p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    {request.mediaType === "MOVIES" ? "Movie" : "Show"} • Quality:{" "}
                    {request.qualityProfileId}
                  </p>
                  {request.mediaType === "SHOWS" && request.season?.length ? (
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      Seasons: {request.season.join(", ")}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    Requested: {formatDateTime(request.createdAt)}
                  </p>
                  {request.status === "APPROVED" ? (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Approved: {formatDateTime(request.approvedAt)}
                    </p>
                  ) : null}
                  {request.status === "DOWNLOADED" ? (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Downloaded: {formatDateTime(request.downloadedAt)}
                    </p>
                  ) : null}

                  {isPending && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => onApprove(request.requestId)}
                        disabled={isApproving || approveLoading}
                        className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-green-600 to-emerald-600 text-white disabled:opacity-60"
                      >
                        {isApproving ? "Approving..." : "Approve & Start Download"}
                      </button>
                      {canDelete && (
                        <button
                          onClick={() => onDelete(request.requestId)}
                          disabled={isDeleting}
                          className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 disabled:opacity-60"
                        >
                          {isDeleting ? "Deleting..." : "Delete Request"}
                        </button>
                      )}
                    </div>
                  )}
                  {!isPending && canDelete && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => onDelete(request.requestId)}
                        disabled={isDeleting}
                        className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 disabled:opacity-60"
                      >
                        {isDeleting ? "Deleting..." : "Delete Request"}
                      </button>
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

MovieHubAdminSection.displayName = "MovieHubAdminSection";

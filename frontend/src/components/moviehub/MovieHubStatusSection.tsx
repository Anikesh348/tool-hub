import React from "react";
import { MovieHubRequest } from "../../apis/moviehub/moviehub";
import { Loader } from "../Loader";
import { MovieHubPagination, usePaginatedItems } from "./MovieHubPagination";

type MovieHubStatusSectionProps = {
  requestsLoading: boolean;
  sortedRequests: MovieHubRequest[];
  deleteLoading: boolean;
  deletingRequestId: string | null;
  onRefresh: () => void;
  onDelete: (requestId: string) => void;
  formatDateTime: (value?: string) => string;
};

export const MovieHubStatusSection: React.FC<MovieHubStatusSectionProps> = React.memo(
  ({
    requestsLoading,
    sortedRequests,
    deleteLoading,
    deletingRequestId,
    onRefresh,
    onDelete,
    formatDateTime,
  }) => {
    const {
      currentPage,
      pageCount,
      pageSize,
      paginatedItems,
      setCurrentPage,
      setPageSize,
    } = usePaginatedItems(sortedRequests, 6);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Your Requests</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              Track status and remove pending requests.
            </p>
          </div>
          <button
            onClick={onRefresh}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
          >
            Refresh
          </button>
        </div>

        {requestsLoading ? (
          <Loader />
        ) : sortedRequests.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-12">
            No requests yet. Go to Request section to place one.
          </p>
        ) : (
          <div className="space-y-3">
            <MovieHubPagination
              currentPage={currentPage}
              pageCount={pageCount}
              pageSize={pageSize}
              totalItems={sortedRequests.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
            />
            {paginatedItems.map((request) => (
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
                {request.status === "PENDING" ? (
                  <div className="mt-3">
                    <button
                      onClick={() => onDelete(request.requestId)}
                      disabled={deleteLoading && deletingRequestId === request.requestId}
                      className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 disabled:opacity-60"
                    >
                      {deleteLoading && deletingRequestId === request.requestId
                        ? "Deleting..."
                        : "Delete Request"}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
            <MovieHubPagination
              currentPage={currentPage}
              pageCount={pageCount}
              pageSize={pageSize}
              totalItems={sortedRequests.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        )}
      </div>
    );
  }
);

MovieHubStatusSection.displayName = "MovieHubStatusSection";

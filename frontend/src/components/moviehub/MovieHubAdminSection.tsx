import React, { useState } from "react";
import { MovieHubRequest } from "../../apis/moviehub/moviehub";
import { Loader } from "../Loader";
import { MovieHubPagination, usePaginatedItems } from "./MovieHubPagination";

type MovieHubAdminSectionProps = {
  adminRequestsLoading: boolean;
  approveLoading: boolean;
  partialApproveLoading: boolean;
  deleteLoading: boolean;
  approvingRequestId: string | null;
  partiallyApprovingRequestId: string | null;
  deletingRequestId: string | null;
  sortedAdminRequests: MovieHubRequest[];
  onRefresh: () => void;
  onApprove: (requestId: string) => void;
  onPartialApprove: (requestId: string, seasons: number[]) => void;
  onDelete: (requestId: string) => void;
  formatDateTime: (value?: string) => string;
};

const SeasonApprovalPicker: React.FC<{
  request: MovieHubRequest;
  availableSeasons: number[];
  isSubmitting: boolean;
  disabled: boolean;
  onPartialApprove: (requestId: string, seasons: number[]) => void;
}> = ({ request, availableSeasons, isSubmitting, disabled, onPartialApprove }) => {
  const [selectedSeasons, setSelectedSeasons] = useState<number[]>(availableSeasons);

  const toggleSeason = (season: number) => {
    setSelectedSeasons((current) =>
      current.includes(season)
        ? current.filter((value) => value !== season)
        : [...current, season].sort((a, b) => a - b),
    );
  };

  const allSelected = selectedSeasons.length === availableSeasons.length;

  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
        Select season(s) to approve:
      </p>
      <div className="flex flex-wrap gap-2 mb-2">
        {availableSeasons.map((season) => {
          const checked = selectedSeasons.includes(season);
          return (
            <label
              key={season}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer border ${
                checked
                  ? "bg-blue-100 dark:bg-blue-900/30 border-blue-400 text-blue-700 dark:text-blue-300"
                  : "bg-gray-100 dark:bg-gray-800 border-transparent text-gray-600 dark:text-gray-300"
              }`}
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={checked}
                onChange={() => toggleSeason(season)}
              />
              S{season}
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onPartialApprove(request.requestId, selectedSeasons)}
          disabled={disabled || isSubmitting || selectedSeasons.length === 0}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-green-600 to-emerald-600 text-white disabled:opacity-60"
        >
          {isSubmitting
            ? "Approving..."
            : allSelected
            ? "Approve All Seasons"
            : `Approve Selected Season${selectedSeasons.length === 1 ? "" : "s"} (${selectedSeasons.length})`}
        </button>
      </div>
    </div>
  );
};

export const MovieHubAdminSection: React.FC<MovieHubAdminSectionProps> = React.memo(
  ({
    adminRequestsLoading,
    approveLoading,
    partialApproveLoading,
    deleteLoading,
    approvingRequestId,
    partiallyApprovingRequestId,
    deletingRequestId,
    sortedAdminRequests,
    onRefresh,
    onApprove,
    onPartialApprove,
    onDelete,
    formatDateTime,
  }) => {
    const pendingCount = sortedAdminRequests.filter((request) => request.status === "PENDING").length;
    const {
      currentPage,
      pageCount,
      pageSize,
      paginatedItems,
      setCurrentPage,
      setPageSize,
    } = usePaginatedItems(sortedAdminRequests, 6);

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
            <MovieHubPagination
              currentPage={currentPage}
              pageCount={pageCount}
              pageSize={pageSize}
              totalItems={sortedAdminRequests.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
            />
            {paginatedItems.map((request) => {
              const isPending = request.status === "PENDING";
              const isApproved = request.status === "APPROVED";
              const isPartiallyApproved = request.status === "PARTIALLY_APPROVED";
              const canDelete = isPending || isApproved || isPartiallyApproved;
              const isApproving = approveLoading && approvingRequestId === request.requestId;
              const isPartialApproving =
                partialApproveLoading && partiallyApprovingRequestId === request.requestId;
              const isDeleting = deleteLoading && deletingRequestId === request.requestId;
              const isMultiSeasonShow =
                request.mediaType === "SHOWS" && (request.season?.length || 0) > 1;
              const seasonsOpenForApproval = isPending
                ? request.season || []
                : request.pendingSeasons || [];
              const showSeasonPicker =
                isMultiSeasonShow &&
                (isPending || isPartiallyApproved) &&
                seasonsOpenForApproval.length > 0;
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
                          : request.status === "PARTIALLY_APPROVED"
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                          : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
                      }`}
                    >
                      {request.status.replace("_", " ")}
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
                      Seasons requested: {request.season.join(", ")}
                    </p>
                  ) : null}
                  {isPartiallyApproved && (
                    <>
                      <p className="mt-1 text-sm text-green-700 dark:text-green-300">
                        Approved so far: {(request.approvedSeasons || []).join(", ") || "-"}
                      </p>
                      <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-300">
                        Still pending: {(request.pendingSeasons || []).join(", ") || "-"}
                      </p>
                    </>
                  )}
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    Requested: {formatDateTime(request.createdAt)}
                  </p>
                  {request.status === "APPROVED" || isPartiallyApproved ? (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Last approved: {formatDateTime(request.approvedAt)}
                    </p>
                  ) : null}
                  {request.status === "DOWNLOADED" ? (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Downloaded: {formatDateTime(request.downloadedAt)}
                    </p>
                  ) : null}

                  {(isPending || isPartiallyApproved) && showSeasonPicker && (
                    <SeasonApprovalPicker
                      request={request}
                      availableSeasons={seasonsOpenForApproval}
                      isSubmitting={isPartialApproving}
                      disabled={partialApproveLoading}
                      onPartialApprove={onPartialApprove}
                    />
                  )}

                  {isPending && !showSeasonPicker && (
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
                  {canDelete && !(isPending && !showSeasonPicker) && (
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
            <MovieHubPagination
              currentPage={currentPage}
              pageCount={pageCount}
              pageSize={pageSize}
              totalItems={sortedAdminRequests.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        )}
      </div>
    );
  }
);

MovieHubAdminSection.displayName = "MovieHubAdminSection";

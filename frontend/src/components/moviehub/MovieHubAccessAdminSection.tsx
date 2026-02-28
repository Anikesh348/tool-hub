import React from "react";
import { Loader } from "../Loader";
import { MovieHubAccessRequest } from "../../apis/moviehub/moviehub";

type MovieHubAccessAdminSectionProps = {
  requests: MovieHubAccessRequest[];
  loading: boolean;
  approvingRequestId: string | null;
  rejectingRequestId: string | null;
  onRefresh: () => void;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
  formatDateTime: (value?: string) => string;
};

export const MovieHubAccessAdminSection: React.FC<MovieHubAccessAdminSectionProps> = ({
  requests,
  loading,
  approvingRequestId,
  rejectingRequestId,
  onRefresh,
  onApprove,
  onReject,
  formatDateTime,
}) => {
  const pendingCount = requests.length;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              MovieHub Access Requests
            </h2>
            {pendingCount > 0 && (
              <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500 text-white">
                {pendingCount} pending
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            Approve pending MovieHub access requests and provision Jellyfin users.
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-semibold"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="py-10 flex justify-center">
          <Loader />
        </div>
      ) : requests.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">No pending access requests.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {requests.map((request) => (
            <div
              key={request.requestId}
              className="moviehub-section-card rounded-2xl p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-bold text-gray-900 dark:text-white truncate">
                    {request.userName || request.userEmail || request.userId}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    Username requested:{" "}
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      {request.movieHubUserName}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Requested: {formatDateTime(request.createdAt)}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onApprove(request.requestId)}
                    disabled={Boolean(approvingRequestId) || Boolean(rejectingRequestId)}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold disabled:opacity-60"
                  >
                    {approvingRequestId === request.requestId ? "Approving..." : "Approve"}
                  </button>
                  <button
                    onClick={() => onReject(request.requestId)}
                    disabled={Boolean(approvingRequestId) || Boolean(rejectingRequestId)}
                    className="px-4 py-2 rounded-xl bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-semibold disabled:opacity-60"
                  >
                    {rejectingRequestId === request.requestId ? "Rejecting..." : "Reject"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

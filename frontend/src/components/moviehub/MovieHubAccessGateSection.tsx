import React from "react";
import { Loader } from "../Loader";
import { MovieHubAccessStatus } from "../../apis/moviehub/moviehub";

type MovieHubAccessGateSectionProps = {
  accessStatus?: MovieHubAccessStatus | null;
  requestedUserName: string;
  loading: boolean;
  onRequestedUserNameChange: (value: string) => void;
  onRequestAccess: () => void;
  onRefreshStatus: () => void;
};

export const MovieHubAccessGateSection: React.FC<MovieHubAccessGateSectionProps> = ({
  accessStatus,
  requestedUserName,
  loading,
  onRequestedUserNameChange,
  onRequestAccess,
  onRefreshStatus,
}) => {
  const status = accessStatus?.status || "NOT_REQUESTED";
  const isPending = status === "PENDING";

  if (isPending) {
    return (
      <div className="max-w-3xl mx-auto moviehub-panel rounded-2xl p-6 sm:p-8 space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Access Request Pending
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            Your MovieHub access request is awaiting admin approval.
          </p>
        </div>

        <div className="rounded-xl border border-amber-300/50 bg-amber-100/20 px-4 py-3 text-sm text-amber-200">
          {accessStatus?.movieHubUserName
            ? `Requested username: ${accessStatus.movieHubUserName}`
            : "Your request has been submitted."}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onRefreshStatus}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-semibold"
          >
            Refresh Status
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto moviehub-panel rounded-2xl p-6 sm:p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Request MovieHub Access
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
          Submit your preferred MovieHub username. A temporary password will be generated securely and sent to your email after approval.
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
          Preferred Username
        </label>
        <input
          value={requestedUserName}
          onChange={(e) => onRequestedUserNameChange(e.target.value)}
          placeholder="letters, numbers, . _ -"
          className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={onRequestAccess}
          disabled={loading || !requestedUserName.trim()}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader size="sm" /> Submitting
            </span>
          ) : (
            "Request MovieHub Access"
          )}
        </button>
        <button
          onClick={onRefreshStatus}
          disabled={loading}
          className="px-5 py-2.5 rounded-xl bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-semibold"
        >
          Refresh Status
        </button>
      </div>
    </div>
  );
};

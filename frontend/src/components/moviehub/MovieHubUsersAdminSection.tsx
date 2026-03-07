import React from "react";
import { Loader } from "../Loader";
import { MovieHubAccessUser } from "../../apis/moviehub/moviehub";

type MovieHubUsersAdminSectionProps = {
  users: MovieHubAccessUser[];
  loading: boolean;
  deletingMappingId: string | null;
  onRefresh: () => void;
  onDelete: (mappingId: string) => void;
  formatDateTime: (value?: string) => string;
};

export const MovieHubUsersAdminSection: React.FC<MovieHubUsersAdminSectionProps> = ({
  users,
  loading,
  deletingMappingId,
  onRefresh,
  onDelete,
  formatDateTime,
}) => {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            MovieHub Users
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            View MovieHub users and remove access from MovieHub and Jellyfin.
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
      ) : users.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          No MovieHub users found.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {users.map((user) => {
            const roleTag = user.roleTag === "ADMIN" ? "ADMIN" : "USER";
            const isDeleting = deletingMappingId === user.mappingId;
            const canDelete = roleTag !== "ADMIN";
            return (
              <div
                key={user.mappingId}
                className="moviehub-section-card rounded-2xl p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-bold text-gray-900 dark:text-white truncate">
                        {user.userName || user.userEmail || user.movieHubUserName}
                      </p>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          roleTag === "ADMIN"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                            : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        }`}
                      >
                        {roleTag}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      MovieHub username:{" "}
                      <span className="font-semibold text-gray-900 dark:text-gray-100">
                        {user.movieHubUserName}
                      </span>
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Email: {user.userEmail || "-"}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Approved: {formatDateTime(user.approvedAt)}
                    </p>
                  </div>
                  <div className="shrink-0">
                    {canDelete ? (
                      <button
                        onClick={() => onDelete(user.mappingId)}
                        disabled={Boolean(deletingMappingId)}
                        className="px-4 py-2 rounded-xl bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-semibold disabled:opacity-60"
                      >
                        {isDeleting ? "Deleting..." : "Delete User"}
                      </button>
                    ) : (
                      <span className="inline-flex items-center px-3 py-2 rounded-xl text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                        Admin user protected
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

import React from "react";
import { Loader } from "../Loader";

type MovieHubOpenSectionProps = {
  isAdmin: boolean;
  username: string;
  userEmail: string;
  showTemporaryPasswordNotice: boolean;
  resending: boolean;
  confirmingPasswordReset: boolean;
  onOpen: () => void;
  onResendPassword: () => void;
  onConfirmPasswordReset: () => void;
};

export const MovieHubOpenSection: React.FC<MovieHubOpenSectionProps> = ({
  isAdmin,
  username,
  userEmail,
  showTemporaryPasswordNotice,
  resending,
  confirmingPasswordReset,
  onOpen,
  onResendPassword,
  onConfirmPasswordReset,
}) => {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Open MovieHub
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
          Open MovieHub and sign in using your assigned credentials.
        </p>
      </div>

      <div className="moviehub-section-card p-4 text-sm text-gray-700 dark:text-gray-300 space-y-2">
        <p>
          Username: <span className="font-semibold text-gray-900 dark:text-white">{username || "-"}</span>
        </p>
        {!isAdmin && showTemporaryPasswordNotice && (
          <p>
            Temporary password has been sent to your mail id
            {userEmail ? ` (${userEmail})` : ""}.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={onOpen}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold"
        >
          Open MovieHub
        </button>

        {!isAdmin && showTemporaryPasswordNotice && (
          <button
            onClick={onResendPassword}
            disabled={resending || !username.trim()}
            className="px-5 py-2.5 rounded-xl bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {resending ? (
              <span className="inline-flex items-center gap-2">
                <Loader size="sm" /> Resending
              </span>
            ) : (
              "Resend Password"
            )}
          </button>
        )}

        {showTemporaryPasswordNotice && !isAdmin && (
          <button
            onClick={onConfirmPasswordReset}
            disabled={confirmingPasswordReset}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {confirmingPasswordReset ? (
              <span className="inline-flex items-center gap-2">
                <Loader size="sm" /> Saving
              </span>
            ) : (
              "I Have Reset My Password"
            )}
          </button>
        )}
      </div>
    </div>
  );
};

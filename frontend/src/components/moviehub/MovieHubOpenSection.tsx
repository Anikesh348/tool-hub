import React from "react";
import { ExternalLink } from "lucide-react";
import { Loader } from "../Loader";

type MovieHubOpenSectionProps = {
  isAdmin: boolean;
  username: string;
  userEmail: string;
  portalUrl: string;
  showTemporaryPasswordNotice: boolean;
  resending: boolean;
  confirmingPasswordReset: boolean;
  onOpenExternal: () => void;
  onResendPassword: () => void;
  onConfirmPasswordReset: () => void;
};

export const MovieHubOpenSection: React.FC<MovieHubOpenSectionProps> = ({
  isAdmin,
  username,
  userEmail,
  portalUrl,
  showTemporaryPasswordNotice,
  resending,
  confirmingPasswordReset,
  onOpenExternal,
  onResendPassword,
  onConfirmPasswordReset,
}) => {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          MovieHub Streaming Portal
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
          Stream inside ToolHub or open MovieHub in a separate page.
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
          onClick={onOpenExternal}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold"
        >
          <ExternalLink className="h-4 w-4" />
          Open in New Page
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

      <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
        <iframe
          src={portalUrl}
          title="MovieHub streaming portal"
          className="block h-[72vh] min-h-[560px] w-full bg-white"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </div>
  );
};

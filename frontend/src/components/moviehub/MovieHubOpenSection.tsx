import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Loader } from "../Loader";
import { AUTH_LOGOUT_EVENT } from "../../apis/auth/authSession";

const MOVIEHUB_EXPECTED_USERNAME_KEY = "toolhub:moviehub:expected-username";
const MOVIEHUB_SESSION_GUARD_KEY = "toolhub:moviehub:session-guard-v1";

type MovieHubOpenSectionProps = {
  isAdmin: boolean;
  username: string;
  userEmail: string;
  portalUrl: string;
  sessionKey: string;
  showTemporaryPasswordNotice: boolean;
  resending: boolean;
  confirmingPasswordReset: boolean;
  onOpenExternal: (url: string) => void;
  onResendPassword: () => void;
  onConfirmPasswordReset: () => void;
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const buildJellyfinWebUrl = (
  portalUrl: string,
  route: "home.html" | "login.html" | "logout.html",
  sessionKey: string,
  username: string,
  includeCacheBust = false,
) => {
  const params = new URLSearchParams({
    toolhubSession: sessionKey || "unknown",
  });
  if (includeCacheBust) {
    params.set("t", String(Date.now()));
  }
  if (username.trim()) {
    params.set("username", username.trim());
  }

  return `${trimTrailingSlash(portalUrl)}/web/#/${route}?${params.toString()}`;
};

export const MovieHubOpenSection: React.FC<MovieHubOpenSectionProps> = ({
  isAdmin,
  username,
  userEmail,
  portalUrl,
  sessionKey,
  showTemporaryPasswordNotice,
  resending,
  confirmingPasswordReset,
  onOpenExternal,
  onResendPassword,
  onConfirmPasswordReset,
}) => {
  const [iframeUrl, setIframeUrl] = useState("");
  const [logoutFrameUrl, setLogoutFrameUrl] = useState("");
  const [isPreparingSession, setIsPreparingSession] = useState(true);
  const normalizedUsername = username.trim();

  const portalHomeUrl = useMemo(
    () =>
      buildJellyfinWebUrl(
        portalUrl,
        "home.html",
        sessionKey,
        normalizedUsername,
      ),
    [portalUrl, sessionKey, normalizedUsername],
  );

  const loginUrl = useMemo(
    () =>
      buildJellyfinWebUrl(
        portalUrl,
        "login.html",
        sessionKey,
        normalizedUsername,
        true,
      ),
    [portalUrl, sessionKey, normalizedUsername],
  );
  const externalPortalUrl = useMemo(
    () => trimTrailingSlash(portalUrl),
    [portalUrl],
  );

  useEffect(() => {
    if (!normalizedUsername) {
      setIframeUrl("about:blank");
      setLogoutFrameUrl("");
      setIsPreparingSession(false);
      return;
    }

    const previousUsername =
      window.localStorage.getItem(MOVIEHUB_EXPECTED_USERNAME_KEY) || "";
    const hasSessionGuard =
      window.localStorage.getItem(MOVIEHUB_SESSION_GUARD_KEY) === "ready";
    const isDifferentExpectedUser =
      !hasSessionGuard ||
      (previousUsername.length > 0 &&
        previousUsername.toLowerCase() !== normalizedUsername.toLowerCase());

    setIsPreparingSession(isDifferentExpectedUser);
    setLogoutFrameUrl("");

    if (isDifferentExpectedUser) {
      setIframeUrl("about:blank");
      setLogoutFrameUrl(
        buildJellyfinWebUrl(
          portalUrl,
          "logout.html",
          sessionKey,
          previousUsername,
          true,
        ),
      );
    } else {
      setIframeUrl((currentUrl) => currentUrl || portalHomeUrl);
    }

    const timeoutId = window.setTimeout(() => {
      setIframeUrl(isDifferentExpectedUser ? loginUrl : portalHomeUrl);
      setIsPreparingSession(false);
      setLogoutFrameUrl("");
      window.localStorage.setItem(
        MOVIEHUB_EXPECTED_USERNAME_KEY,
        normalizedUsername,
      );
      window.localStorage.setItem(MOVIEHUB_SESSION_GUARD_KEY, "ready");
    }, isDifferentExpectedUser ? 900 : 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loginUrl, normalizedUsername, portalHomeUrl, portalUrl, sessionKey]);

  useEffect(() => {
    const handleToolHubLogout = () => {
      window.localStorage.removeItem(MOVIEHUB_EXPECTED_USERNAME_KEY);
      window.localStorage.removeItem(MOVIEHUB_SESSION_GUARD_KEY);
      if (!normalizedUsername) return;
      setLogoutFrameUrl(
        buildJellyfinWebUrl(
          portalUrl,
          "logout.html",
          sessionKey,
          normalizedUsername,
          true,
        ),
      );
    };

    window.addEventListener(AUTH_LOGOUT_EVENT, handleToolHubLogout);
    return () => {
      window.removeEventListener(AUTH_LOGOUT_EVENT, handleToolHubLogout);
    };
  }, [normalizedUsername, portalUrl, sessionKey]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-1.5 sm:gap-2">
      <div className="moviehub-section-card px-2.5 sm:px-3 py-2 text-sm text-gray-700 dark:text-gray-300 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
            Streaming as
          </span>
          <span className="min-w-0 truncate rounded-full border border-gray-200/80 dark:border-gray-700 bg-white/70 dark:bg-slate-950/50 px-2.5 py-1 text-xs font-semibold text-gray-900 dark:text-white">
            {username || "-"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onOpenExternal(externalPortalUrl)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200/80 dark:border-blue-900/70 bg-blue-50/70 dark:bg-blue-950/30 px-2.5 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-100/80 dark:hover:bg-blue-900/40"
            title="Open in New Page"
          >
            <ExternalLink className="h-4 w-4" />
            Open in New Page
          </button>

          {!isAdmin && showTemporaryPasswordNotice && (
            <button
              onClick={onResendPassword}
              disabled={resending || !username.trim()}
              className="rounded-lg bg-gray-100/80 dark:bg-gray-800/80 px-2.5 py-1.5 text-xs font-semibold text-gray-800 dark:text-gray-200 disabled:opacity-60 disabled:cursor-not-allowed"
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
              className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed"
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

      {!isAdmin && showTemporaryPasswordNotice && (
        <div className="moviehub-section-card px-3 py-2 text-xs text-gray-700 dark:text-gray-300">
          Temporary password has been sent to your mail id
          {userEmail ? ` (${userEmail})` : ""}.
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-2xl shadow-slate-900/10 dark:shadow-black/30">
        {logoutFrameUrl && (
          <iframe
            src={logoutFrameUrl}
            title="MovieHub session reset"
            className="hidden"
            aria-hidden="true"
          />
        )}
        {isPreparingSession && (
          <div className="flex h-full min-h-[320px] w-full items-center justify-center gap-3 text-sm font-semibold text-gray-700 dark:text-gray-200">
            <Loader size="sm" />
            Preparing MovieHub session
          </div>
        )}
        <iframe
          src={iframeUrl}
          title="MovieHub streaming portal"
          className={`h-full min-h-0 w-full bg-white ${
            isPreparingSession ? "hidden" : "block"
          }`}
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </div>
  );
};

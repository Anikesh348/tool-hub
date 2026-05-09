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
    const shouldResetJellyfinSession =
      !hasSessionGuard ||
      (previousUsername.length > 0 &&
        previousUsername.toLowerCase() !== normalizedUsername.toLowerCase());

    setIsPreparingSession(shouldResetJellyfinSession);
    setLogoutFrameUrl("");

    if (shouldResetJellyfinSession) {
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
      setIframeUrl(shouldResetJellyfinSession ? loginUrl : portalHomeUrl);
      setIsPreparingSession(false);
      setLogoutFrameUrl("");
      window.localStorage.setItem(
        MOVIEHUB_EXPECTED_USERNAME_KEY,
        normalizedUsername,
      );
      window.localStorage.setItem(MOVIEHUB_SESSION_GUARD_KEY, "ready");
    }, shouldResetJellyfinSession ? 900 : 0);

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
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
            MovieHub Streaming Portal
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            Stream inside ToolHub or open MovieHub in a separate page.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={() => onOpenExternal(loginUrl)}
            className="inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold"
          >
            <ExternalLink className="h-4 w-4" />
            Open in New Page
          </button>

          {!isAdmin && showTemporaryPasswordNotice && (
            <button
              onClick={onResendPassword}
              disabled={resending || !username.trim()}
              className="px-4 sm:px-5 py-2.5 rounded-xl bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
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
              className="px-4 sm:px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
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

      <div className="moviehub-section-card px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <p className="shrink-0">
          Username: <span className="font-semibold text-gray-900 dark:text-white">{username || "-"}</span>
        </p>
        {!isAdmin && showTemporaryPasswordNotice && (
          <p className="sm:border-l sm:border-gray-300 sm:dark:border-gray-700 sm:pl-3">
            Temporary password has been sent to your mail id
            {userEmail ? ` (${userEmail})` : ""}.
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-2xl shadow-slate-900/10 dark:shadow-black/30">
        {logoutFrameUrl && (
          <iframe
            src={logoutFrameUrl}
            title="MovieHub session reset"
            className="hidden"
            aria-hidden="true"
          />
        )}
        {isPreparingSession && (
          <div className="flex h-[calc(100vh-15.5rem)] min-h-[640px] w-full items-center justify-center gap-3 text-sm font-semibold text-gray-700 dark:text-gray-200 max-sm:h-[70vh] max-sm:min-h-[520px]">
            <Loader size="sm" />
            Preparing MovieHub session
          </div>
        )}
        <iframe
          src={iframeUrl}
          title="MovieHub streaming portal"
          className={`h-[calc(100vh-15.5rem)] min-h-[640px] w-full bg-white max-sm:h-[70vh] max-sm:min-h-[520px] ${
            isPreparingSession ? "hidden" : "block"
          }`}
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </div>
  );
};

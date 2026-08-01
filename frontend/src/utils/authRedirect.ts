import type { Location } from "react-router-dom";

const AUTH_RETURN_PATH_KEY = "toolhub:auth-return-path";
const AUTH_PATHS = new Set(["/login", "/register"]);
const INTERNAL_ORIGIN = "https://toolhub.local";

type LocationParts = Pick<Location, "pathname" | "search" | "hash">;

export const locationPath = ({ pathname, search, hash }: LocationParts) =>
  `${pathname}${search || ""}${hash || ""}`;

const safeInternalPath = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return null;
  }

  try {
    const parsed = new URL(candidate, INTERNAL_ORIGIN);
    if (parsed.origin !== INTERNAL_ORIGIN || AUTH_PATHS.has(parsed.pathname)) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
};

const stateReturnPath = (state: unknown): string | null => {
  if (!state || typeof state !== "object" || !("from" in state)) return null;
  return safeInternalPath((state as { from?: unknown }).from);
};

export const rememberAuthReturnPath = (location: LocationParts) => {
  if (AUTH_PATHS.has(location.pathname) || typeof window === "undefined") return;
  const path = safeInternalPath(locationPath(location));
  if (!path) return;
  try {
    window.sessionStorage.setItem(AUTH_RETURN_PATH_KEY, path);
  } catch {
    // Sign-in should still work if browser storage is unavailable.
  }
};

export const resolveAuthReturnPath = (state: unknown, fallback = "/") => {
  const explicitPath = stateReturnPath(state);
  if (explicitPath) return explicitPath;
  if (typeof window === "undefined") return fallback;
  try {
    return safeInternalPath(window.sessionStorage.getItem(AUTH_RETURN_PATH_KEY)) || fallback;
  } catch {
    return fallback;
  }
};

export const clearAuthReturnPath = () => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(AUTH_RETURN_PATH_KEY);
  } catch {
    // Nothing else is required if browser storage is unavailable.
  }
};

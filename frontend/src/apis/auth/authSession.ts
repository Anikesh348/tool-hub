import { AuthService, type User } from "./auth";

export const AUTH_SESSION_UPDATED_EVENT = "toolhub:auth-session-updated";
export const AUTH_LOGOUT_EVENT = "toolhub:auth-logout";

let refreshPromise: Promise<boolean> | null = null;
// 10s was too tight: a page reload racing with any transient slowness (e.g. a
// slow-but-legitimate in-flight request elsewhere) could abort this and get
// misread as "not authenticated", bouncing a fully logged-in user to /login.
const AUTH_REQUEST_TIMEOUT_MS = 20_000;

const fetchAuthRequest = async (
  url: string,
  options?: RequestInit,
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    AUTH_REQUEST_TIMEOUT_MS,
  );
  try {
    return await fetch(url, { ...(options || {}), signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const readResponseBody = async (response: Response): Promise<any | null> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

export const refreshAccessToken = async (): Promise<boolean> => {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const { url, options } = AuthService.refreshSession();
      const response = await fetchAuthRequest(url, options);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
        }
        return false;
      }
      window.dispatchEvent(new Event(AUTH_SESSION_UPDATED_EVENT));
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

// Thrown when the session check itself couldn't be completed (network error,
// abort/timeout) - distinct from the server confirming "you're not logged
// in". Callers should not treat this the same as an actual logout.
export class SessionCheckUnavailableError extends Error {}

export const fetchCurrentSession = async (): Promise<User | null> => {
  const { url, options } = AuthService.currentSession();
  let response: Response;
  try {
    response = await fetchAuthRequest(url, options);
    if (response.status === 401 && (await refreshAccessToken())) {
      response = await fetchAuthRequest(url, options);
    }
  } catch (err) {
    throw new SessionCheckUnavailableError(
      err instanceof Error ? err.message : "Session check failed",
    );
  }
  if (!response.ok) return null;
  const body = await readResponseBody(response);
  return body?.authenticated && body?.user ? (body.user as User) : null;
};

export const endSession = async (): Promise<void> => {
  const { url, options } = AuthService.logout();
  try {
    await fetchAuthRequest(url, options);
  } finally {
    window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
  }
};

import { AuthService } from "./auth";
import { clearStoredAuth, getRefreshToken, setStoredTokens } from "./tokenStorage";

export const AUTH_TOKENS_UPDATED_EVENT = "toolhub:auth-token-updated";
export const AUTH_LOGOUT_EVENT = "toolhub:auth-logout";

let refreshPromise: Promise<string | null> | null = null;

const emitAuthTokensUpdated = () => {
  window.dispatchEvent(new Event(AUTH_TOKENS_UPDATED_EVENT));
};

const emitAuthLogout = () => {
  window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
};

const readResponseBody = async (response: Response): Promise<any | null> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

export const refreshAccessToken = async (): Promise<string | null> => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return null;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const { url, options } = AuthService.refreshToken(refreshToken);
      const response = await fetch(url, options);
      const body = await readResponseBody(response);

      if (!response.ok) {
        clearStoredAuth();
        emitAuthLogout();
        return null;
      }

      const newAccessToken = body?.accessToken || body?.token;
      const newRefreshToken = body?.refreshToken;
      if (!newAccessToken || !newRefreshToken) {
        clearStoredAuth();
        emitAuthLogout();
        return null;
      }

      setStoredTokens(newAccessToken, newRefreshToken);
      emitAuthTokensUpdated();
      return newAccessToken;
    } catch {
      clearStoredAuth();
      emitAuthLogout();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

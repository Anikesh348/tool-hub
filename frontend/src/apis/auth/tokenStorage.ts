import type { User } from "./auth";

const AUTH_TOKEN_KEY = "authToken";
const REFRESH_TOKEN_KEY = "refreshToken";
const USER_KEY = "user";

interface JwtPayload {
  exp?: number;
}

const decodeBase64Url = (value: string): string => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(normalized + padding);
};

export const getAccessToken = (): string | null =>
  localStorage.getItem(AUTH_TOKEN_KEY);

export const getRefreshToken = (): string | null =>
  localStorage.getItem(REFRESH_TOKEN_KEY);

export const getStoredUser = (): User | null => {
  const rawUser = localStorage.getItem(USER_KEY);
  if (!rawUser) return null;
  try {
    return JSON.parse(rawUser) as User;
  } catch {
    return null;
  }
};

export const setStoredTokens = (
  accessToken: string,
  refreshToken: string
): void => {
  localStorage.setItem(AUTH_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
};

export const setStoredUser = (user: User): void => {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const clearStoredAuth = (): void => {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

export const decodeJwtPayload = (token: string): JwtPayload | null => {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const decoded = decodeBase64Url(parts[1]);
    return JSON.parse(decoded) as JwtPayload;
  } catch {
    return null;
  }
};

export const getJwtExpiryEpochMs = (token: string): number | null => {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return null;
  return payload.exp * 1000;
};

export const isJwtExpired = (token: string, skewSeconds = 0): boolean => {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= now + skewSeconds;
};

export const getBearerAuthHeader = (): Record<string, string> => {
  const accessToken = getAccessToken();
  if (!accessToken) {
    return {};
  }
  return {
    Authorization: `Bearer ${accessToken}`,
  };
};

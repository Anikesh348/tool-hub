const LEGACY_AUTH_KEYS = ["authToken", "refreshToken", "user"];

export const clearLegacyStoredAuth = (): void => {
  LEGACY_AUTH_KEYS.forEach((key) => localStorage.removeItem(key));
};

// Existing API modules call this helper. Browser authentication now travels
// exclusively through HttpOnly cookies, so no JavaScript auth header is added.
export const getBearerAuthHeader = (): Record<string, string> => ({});

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { Product } from "../apis/search/search";
import { User } from "../apis/auth/auth";
import {
  clearStoredAuth,
  getAccessToken,
  getJwtExpiryEpochMs,
  getRefreshToken,
  getStoredUser,
  isJwtExpired,
  setStoredTokens,
  setStoredUser,
} from "../apis/auth/tokenStorage";
import {
  AUTH_LOGOUT_EVENT,
  AUTH_TOKENS_UPDATED_EVENT,
  refreshAccessToken,
} from "../apis/auth/authSession";

interface AuthContextObj {
  authToken: string | null | undefined;
  isAuthLoading: boolean;
  isAuthenticated: boolean;
  login: (accessToken: string, refreshToken: string, user: User) => void;
  logout: () => void;
  searchResults: Product[];
  user: User | undefined | null;
  updateSearchState: (results: Product[]) => void;
}

const AuthContext = createContext<AuthContextObj | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [authToken, setAuthToken] = useState<string | null | undefined>(
    undefined
  );
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [searchResults, setSearchResults] = useState<Product[]>([]);

  const logout = useCallback(() => {
    clearStoredAuth();
    window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
    setAuthToken(null);
    setUser(undefined);
  }, []);

  const login = useCallback(
    (accessToken: string, refreshToken: string, nextUser: User) => {
      setStoredTokens(accessToken, refreshToken);
      setStoredUser(nextUser);
      setAuthToken(accessToken);
      setUser(nextUser);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrapAuth = async () => {
      const storedUser = getStoredUser();
      const storedToken = getAccessToken();
      const storedRefreshToken = getRefreshToken();

      if (storedToken && !isJwtExpired(storedToken, 10)) {
        if (!cancelled) {
          setAuthToken(storedToken);
          setUser(storedUser ?? undefined);
        }
        return;
      }

      // Always attempt refresh when refresh token exists.
      // Backend is the source of truth for refresh token validity/expiry.
      if (storedRefreshToken) {
        const refreshedAccessToken = await refreshAccessToken();
        if (!cancelled) {
          if (refreshedAccessToken) {
            setAuthToken(refreshedAccessToken);
            setUser(storedUser ?? undefined);
          } else {
            setAuthToken(null);
            setUser(undefined);
          }
        }
        return;
      }

      clearStoredAuth();
      if (!cancelled) {
        setAuthToken(null);
        setUser(undefined);
      }
    };

    bootstrapAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onTokenUpdated = () => {
      const latestAccessToken = getAccessToken();
      if (latestAccessToken) {
        setAuthToken(latestAccessToken);
      }
    };

    const onLogout = () => {
      setAuthToken(null);
      setUser(undefined);
    };

    window.addEventListener(AUTH_TOKENS_UPDATED_EVENT, onTokenUpdated);
    window.addEventListener(AUTH_LOGOUT_EVENT, onLogout);

    return () => {
      window.removeEventListener(AUTH_TOKENS_UPDATED_EVENT, onTokenUpdated);
      window.removeEventListener(AUTH_LOGOUT_EVENT, onLogout);
    };
  }, []);

  useEffect(() => {
    if (!authToken) return;

    const expiryEpochMs = getJwtExpiryEpochMs(authToken);
    if (!expiryEpochMs) return;

    const refreshLeadTimeMs = 60 * 1000;
    const refreshInMs = Math.max(expiryEpochMs - Date.now() - refreshLeadTimeMs, 1000);

    const timeoutId = window.setTimeout(async () => {
      const refreshedToken = await refreshAccessToken();
      if (!refreshedToken) {
        logout();
        return;
      }
      setAuthToken(refreshedToken);
    }, refreshInMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authToken, logout]);

  const updateSearchState = useCallback((results: Product[]) => {
    setSearchResults(results);
  }, []);

  const isAuthenticated = !!authToken;
  const isAuthLoading = authToken === undefined;

  return (
    <AuthContext.Provider
      value={{
        authToken,
        isAuthLoading,
        isAuthenticated,
        login,
        logout,
        user,
        searchResults,
        updateSearchState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextObj => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

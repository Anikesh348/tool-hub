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
import { clearLegacyStoredAuth } from "../apis/auth/tokenStorage";
import {
  AUTH_LOGOUT_EVENT,
  AUTH_SESSION_UPDATED_EVENT,
  endSession,
  fetchCurrentSession,
  refreshAccessToken,
} from "../apis/auth/authSession";

interface AuthContextObj {
  authToken: string | null | undefined;
  isAuthLoading: boolean;
  isAuthenticated: boolean;
  login: (user: User) => void;
  logout: () => Promise<void>;
  searchResults: Product[];
  user: User | undefined | null;
  updateSearchState: (results: Product[]) => void;
}

const AUTHENTICATED_SESSION = "cookie-session";
const AuthContext = createContext<AuthContextObj | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [authToken, setAuthToken] = useState<string | null | undefined>(
    undefined
  );
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const isAuthenticated = authToken === AUTHENTICATED_SESSION;
  const isAuthLoading = authToken === undefined;

  const applySession = useCallback((nextUser: User | null) => {
    setAuthToken(nextUser ? AUTHENTICATED_SESSION : null);
    setUser(nextUser ?? undefined);
  }, []);

  const logout = useCallback(async () => {
    await endSession();
    applySession(null);
  }, [applySession]);

  const login = useCallback(
    (nextUser: User) => {
      applySession(nextUser);
    },
    [applySession]
  );

  useEffect(() => {
    let cancelled = false;
    clearLegacyStoredAuth();

    const bootstrapSession = async () => {
      try {
        return await fetchCurrentSession();
      } catch {
        // The check itself failed (network hiccup, or a reload racing a
        // slow-but-legitimate response elsewhere) - not a confirmed logout.
        // Give it one more try before accepting the user is signed out, so a
        // single blip doesn't bounce an otherwise-logged-in user to /login.
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        try {
          return await fetchCurrentSession();
        } catch {
          return null;
        }
      }
    };

    bootstrapSession().then((sessionUser) => {
      if (!cancelled) applySession(sessionUser);
    });

    return () => {
      cancelled = true;
    };
  }, [applySession]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = window.setInterval(() => {
      refreshAccessToken();
    }, 10 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [isAuthenticated]);

  useEffect(() => {
    const onSessionUpdated = async () => {
      try {
        const sessionUser = await fetchCurrentSession();
        applySession(sessionUser);
      } catch {
        // A refresh just succeeded, so the session is known-good - a
        // transient failure here shouldn't override that with a logout.
      }
    };
    const onLogout = () => applySession(null);

    window.addEventListener(AUTH_SESSION_UPDATED_EVENT, onSessionUpdated);
    window.addEventListener(AUTH_LOGOUT_EVENT, onLogout);
    return () => {
      window.removeEventListener(AUTH_SESSION_UPDATED_EVENT, onSessionUpdated);
      window.removeEventListener(AUTH_LOGOUT_EVENT, onLogout);
    };
  }, [applySession]);

  const updateSearchState = useCallback((results: Product[]) => {
    setSearchResults(results);
  }, []);

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

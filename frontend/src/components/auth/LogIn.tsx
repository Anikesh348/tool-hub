import React, { useCallback, useEffect, useRef, useState } from "react";
import { useApiFetcher } from "../../hooks/useApiFetcher";
import { AuthService } from "../../apis/auth/auth";
import { useAuth } from "../../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { useNotification } from "../../context/NotificationContext";
import { ShieldCheck, Sparkles, Zap } from "lucide-react";

let googleScriptPromise: Promise<void> | null = null;

const loadGoogleScript = () => {
  if (googleScriptPromise) {
    return googleScriptPromise;
  }
  googleScriptPromise = new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const existingScript = document.getElementById("google-login-script");
    if (existingScript) {
      if (existingScript.getAttribute("data-loaded") === "true") {
        resolve();
        return;
      }
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Google script failed to load")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.id = "google-login-script";
    script.onload = () => {
      script.setAttribute("data-loaded", "true");
      resolve();
    };
    script.onerror = () => reject(new Error("Google script failed to load"));
    document.head.appendChild(script);
  });
  return googleScriptPromise;
};

export const LogIn = () => {
  const { loading, data, fetchData } = useApiFetcher();
  const { login, isAuthenticated } = useAuth();
  const { addNotification } = useNotification();
  const [googleReady, setGoogleReady] = useState(false);
  const [isDark, setIsDark] = useState<boolean>(() =>
    document.documentElement.classList.contains("dark"),
  );
  const initializedRef = useRef(false);
  const googleButtonContainerRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  const handleCredentialResponse = useCallback(
    (response: { credential?: string }) => {
      const idToken = response?.credential;
      if (!idToken) {
        addNotification("Google sign-in failed. Please try again.", "error");
        return;
      }
      const { url, options } = AuthService.googleLogin(idToken);
      fetchData(url, options);
    },
    [addNotification, fetchData],
  );

  const renderGoogleButton = useCallback(() => {
    if (!googleButtonContainerRef.current || !window.google?.accounts?.id) {
      return;
    }
    const container = googleButtonContainerRef.current;
    const width = Math.max(220, Math.min(380, container.clientWidth - 8));
    container.innerHTML = "";
    window.google.accounts.id.renderButton(container, {
      type: "standard",
      theme: isDark ? "filled_black" : "outline",
      size: "large",
      text: "continue_with",
      shape: "pill",
      logo_alignment: "left",
      width: String(width),
    });
  }, [isDark]);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isAuthenticated || !GOOGLE_CLIENT_ID) {
      return;
    }

    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id) return;
        if (!initializedRef.current) {
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleCredentialResponse,
          });
          initializedRef.current = true;
        }
        renderGoogleButton();
        setGoogleReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          addNotification("Unable to load Google sign-in. Please refresh.", "error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    GOOGLE_CLIENT_ID,
    isAuthenticated,
    handleCredentialResponse,
    addNotification,
    renderGoogleButton,
  ]);

  useEffect(() => {
    if (!googleReady) return;
    renderGoogleButton();
  }, [googleReady, isDark, renderGoogleButton]);

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/");
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    const accessToken = data?.body?.accessToken || data?.body?.token;
    const refreshToken = data?.body?.refreshToken;

    if (data && data.status === 200 && accessToken && refreshToken) {
      login(accessToken, refreshToken, data.body.user);
      addNotification("Login successful!", "success");
      navigate("/");
    } else if (data && data.status !== 200) {
      addNotification(
        data?.body?.message || "Login failed. Please try again.",
        "error"
      );
    }
  }, [data, login, navigate, addNotification]);

  return (
    <div className="relative min-h-screen w-full landing-bg transition-colors duration-300 overflow-hidden">
      <div className="pointer-events-none absolute -top-24 -left-24 h-64 w-64 rounded-full bg-blue-500/15 blur-3xl" />
      <div className="pointer-events-none absolute top-1/2 -right-20 h-72 w-72 rounded-full bg-fuchsia-500/15 blur-3xl" />

      <div className="flex items-center justify-center min-h-screen pt-16 px-4">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="hidden lg:flex rounded-3xl border border-slate-200/60 dark:border-slate-700/60 bg-white/55 dark:bg-slate-900/45 backdrop-blur-xl p-8 shadow-xl">
            <div className="flex flex-col justify-between w-full">
              <div className="space-y-5">
                <span className="inline-flex items-center gap-2 text-xs font-bold tracking-wide uppercase px-3 py-1.5 rounded-full bg-blue-100/80 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  <Sparkles className="w-3.5 h-3.5" />
                  ToolHub Access
                </span>
                <h1 className="text-4xl font-extrabold leading-tight text-slate-900 dark:text-white">
                  One secure login for every tool.
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-300 max-w-md">
                  Continue with Google to access Price Tracker, MovieHub, and the rest of your workspace.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 mt-8">
                <div className="rounded-2xl border border-slate-200/70 dark:border-slate-700/70 bg-white/70 dark:bg-slate-950/30 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                    Secure Sign-In
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Trusted authentication with automatic account linking.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200/70 dark:border-slate-700/70 bg-white/70 dark:bg-slate-950/30 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    <Zap className="w-4 h-4 text-violet-500" />
                    Fast Entry
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Open your dashboard in seconds without extra password steps.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="glass-card border border-gray-200 dark:border-gray-700 rounded-3xl p-8 sm:p-10 w-full shadow-2xl">
            <div className="text-center mb-8">
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 dark:text-white mb-2">
                Welcome Back
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Continue to ToolHub
              </p>
            </div>

            <div className="space-y-4">
              <div className="w-full rounded-2xl border border-blue-200/70 dark:border-violet-700/50 bg-gradient-to-r from-blue-50/75 to-violet-50/75 dark:from-slate-900/80 dark:to-violet-950/35 p-4 shadow-sm">
                <div
                  ref={googleButtonContainerRef}
                  className="min-h-[44px] flex items-center justify-center"
                />
                {!googleReady || loading ? (
                  <p className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">
                    {loading ? "Signing in..." : "Loading Google sign-in..."}
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

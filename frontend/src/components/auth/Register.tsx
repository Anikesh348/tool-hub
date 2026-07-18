import React, { useEffect, useState } from "react";
import { User, AuthService } from "../../apis/auth/auth";
import { useApiFetcher } from "../../hooks/useApiFetcher";
import { useNavigate, Link } from "react-router-dom";
import { Loader } from "../Loader";
import { useAuth } from "../../context/AuthContext";
import { useNotification } from "../../context/NotificationContext";

function Register() {
  const { loading, data, error, fetchData } = useApiFetcher();
  const { login, isAuthenticated } = useAuth();
  const { addNotification } = useNotification();
  const navigate = useNavigate();
  const [user, setUser] = useState({
    name: "",
    email: "",
    password: "",
    profilePicture: "",
  });

  const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    const loadGoogleScript = () => {
      return new Promise<void>((resolve, reject) => {
        if (document.getElementById("google-login-script")) {
          resolve();
          return;
        }
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.id = "google-login-script";
        script.onload = () => resolve();
        script.onerror = () => reject("Google script failed to load");
        document.body.appendChild(script);
      });
    };

    loadGoogleScript()
      .then(() => {
        if (!isAuthenticated && window.google && GOOGLE_CLIENT_ID) {
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleCredentialResponse,
          });

          window.google.accounts.id.renderButton(
            document.getElementById("google-signin-button-register"),
            { theme: "outline", size: "large" }
          );
        }
      })
      .catch((err) => console.error(err));
  }, [GOOGLE_CLIENT_ID, isAuthenticated]);

  const handleCredentialResponse = (response: any) => {
    const idToken = response.credential;
    const { url, options } = AuthService.googleLogin(idToken);
    fetchData(url, options);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const { url, options } = AuthService.baseRegister(user as User);
    fetchData(url, options);
  };

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/");
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (data && data?.status === 200) {
      addNotification("Registration successful!", "success");
      if (data.body?.authenticated && data.body?.user) {
        // If registration auto-logs in
        login(data.body.user);
        navigate("/");
      } else {
        // If registration doesn't auto-login, redirect to login
        navigate("/login");
      }
    } else if (data && data?.status !== 200) {
      addNotification(
        data?.body?.message || "Registration failed. Please try again.",
        "error"
      );
    }
  }, [data, error, navigate, login, addNotification]);

  const isFormValid =
    user.name.trim() !== "" &&
    user.email.trim() !== "" &&
    user.password.trim() !== "" &&
    user.password.length >= 6;

  return (
    <div className="portal-page min-h-screen w-full transition-colors duration-300">
      {/* Main Content */}
      <div className="flex items-center justify-center min-h-screen pt-16">
        <div className="glass-card border border-gray-200 dark:border-gray-700 rounded-3xl p-8 w-full max-w-md mx-4 shadow-xl">
          <div className="text-center mb-8">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 dark:text-white mb-2">
              Create Account
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Join ToolHub and start tracking prices & coding practice
            </p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Full Name
              </label>
              <input
                value={user.name}
                type="text"
                placeholder="John Doe"
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                onChange={(event) =>
                  setUser((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Email Address
              </label>
              <input
                value={user.email}
                type="email"
                placeholder="you@example.com"
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                onChange={(event) =>
                  setUser((prev) => ({
                    ...prev,
                    email: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Password
              </label>
              <input
                value={user.password}
                type="password"
                placeholder="••••••••"
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                onChange={(event) =>
                  setUser((prev) => ({
                    ...prev,
                    password: event.target.value,
                  }))
                }
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Minimum 6 characters
              </p>
            </div>
            <button
              type="submit"
              disabled={!isFormValid || loading}
              className={`w-full py-3 rounded-xl font-semibold transition-all ${
                isFormValid && !loading
                  ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:shadow-lg active:scale-95"
                  : "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
              }`}
            >
              {loading ? (
                <div className="flex justify-center">
                  <Loader />
                </div>
              ) : (
                "Create Account"
              )}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-3 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 font-medium">
                Or continue with
              </span>
            </div>
          </div>

          <div
            style={{ display: "flex", justifyContent: "center" }}
            id="google-signin-button-register"
            className="mb-6"
          ></div>

          <p className="text-center text-sm text-gray-600 dark:text-gray-400">
            Already have an account?{" "}
            <Link
              to="/login"
              className="font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition"
            >
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Register;

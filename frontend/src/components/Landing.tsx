import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { CinePilotLauncher } from "./CineBotLauncher";
import { CinePilotChat } from "./CineBot";

export const Landing = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isAuthLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<"track" | "leetcode" | null>(null);
  const { user } = useAuth();
  const [showCinePilot, setShowCinePilot] = useState(false);

  useEffect(() => {
    if (location.pathname.startsWith("/leetcode")) setActiveTab("leetcode");
    else if (location.pathname.startsWith("/pricetracker"))
      setActiveTab("track");
    else setActiveTab(null);
  }, [location.pathname]);

  const handleServiceClick = (path: string, tab: "track" | "leetcode") => {
    if (isAuthLoading) return; // avoid action while auth loading
    if (!isAuthenticated) {
      // redirect to login and preserve intended path
      navigate("/login", { state: { from: path } });
      return;
    }
    setActiveTab(tab);
    navigate(path);
  };

  return (
    <div className="min-h-screen w-full landing-bg px-4 pt-24 pb-12">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8 text-center">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight drop-shadow-lg">
            ToolHub - Price Tracker & LeetCode Manager
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
            Your all-in-one platform for Amazon price drop tracking and LeetCode
            question management. Track price drops, manage your coding practice,
            and boost your productivity with ToolHub.
          </p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Price Tracker Card */}
          <div
            className={`glass-card border ${
              activeTab === "track"
                ? "border-transparent shadow-lg"
                : "border-gray-200 dark:border-gray-700"
            } rounded-2xl p-6 hover:shadow-xl transition flex flex-col`}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 text-white flex items-center justify-center font-bold">
                  P
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                  Core
                </span>
              </div>
            </div>

            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Amazon Price Drop Tracker
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 flex-grow mb-6">
              Track price drops on Amazon and other platforms. Get real-time
              notifications when prices fall and never miss a great deal. Our
              advanced price tracker monitors your products 24/7.
            </p>

            <div className="flex items-center gap-3 mt-auto">
              <button
                onClick={() => handleServiceClick("/pricetracker", "track")}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition"
              >
                Open
              </button>
              <button
                onClick={() => navigate("/pricetracker/dashboard")}
                className="text-sm text-gray-500 dark:text-gray-400 underline hover:text-gray-700"
              >
                Dashboard
              </button>
            </div>
          </div>

          {/* LeetCode Manager Card */}
          <div
            className={`glass-card border ${
              activeTab === "leetcode"
                ? "border-transparent shadow-lg"
                : "border-gray-200 dark:border-gray-700"
            } rounded-2xl p-6 hover:shadow-xl transition flex flex-col`}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 text-white flex items-center justify-center font-bold">
                  L
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                  Productivity
                </span>
              </div>
            </div>

            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              LeetCode Manager & Question Tracker
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 flex-grow mb-6">
              Organize and track your LeetCode practice with advanced
              note-taking, tagging, and progress tracking. Perfect for interview
              preparation and coding skill development.
            </p>

            <div className="flex items-center gap-3 mt-auto">
              <button
                onClick={() => handleServiceClick("/leetcode", "leetcode")}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition"
              >
                Open
              </button>
            </div>
          </div>

          {/* Placeholder for future feature */}
          <div className="glass-card border border-dashed border-gray-200 dark:border-gray-700 rounded-2xl p-6 flex flex-col justify-between hover:shadow-xl transition">
            <div>
              <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 flex items-center justify-center font-bold">
                +
              </div>
              <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
                Coming Soon
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                We're planning more tools — stay tuned.
              </p>
            </div>

            <div className="mt-6 text-right">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Beta
              </span>
            </div>
          </div>
        </div>
      </div>
      {user?.role === "ADMIN" && (
        <>
          <CinePilotLauncher onClick={() => setShowCinePilot(true)} />
          {showCinePilot && (
            <CinePilotChat onClose={() => setShowCinePilot(false)} />
          )}
        </>
      )}
    </div>
  );
};

export default Landing;

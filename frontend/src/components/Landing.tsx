import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  ArrowRight,
  ChartNoAxesCombined,
  Clapperboard,
  Code2,
  Sparkles,
} from "lucide-react";

export const Landing = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isAuthLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<
    "track" | "leetcode" | "moviehub" | null
  >(null);

  useEffect(() => {
    if (location.pathname.startsWith("/leetcode")) setActiveTab("leetcode");
    else if (location.pathname.startsWith("/moviehub")) setActiveTab("moviehub");
    else if (location.pathname.startsWith("/pricetracker"))
      setActiveTab("track");
    else setActiveTab(null);
  }, [location.pathname]);

  const handleServiceClick = (
    path: string,
    tab: "track" | "leetcode" | "moviehub"
  ) => {
    if (isAuthLoading) return; // avoid action while auth loading
    if (!isAuthenticated) {
      // redirect to login and preserve intended path
      navigate("/login", { state: { from: path } });
      return;
    }
    setActiveTab(tab);
    navigate(path);
  };

  const tools = [
    {
      key: "track" as const,
      path: "/pricetracker",
      label: "Core",
      title: "Amazon Price Drop Tracker",
      description:
        "Track products across stores, get notified on drops, and review historical trends in one dashboard.",
      highlights: ["Live alerts", "Smart history", "Dashboard"],
      icon: ChartNoAxesCombined,
      iconGradient:
        "from-cyan-500 via-blue-500 to-indigo-500",
    },
    {
      key: "leetcode" as const,
      path: "/leetcode",
      label: "Productivity",
      title: "LeetCode Manager",
      description:
        "Organize coding prep with tags, notes, progress views, and focused practice workflows.",
      highlights: ["Topic tags", "Revision notes", "Progress tracking"],
      icon: Code2,
      iconGradient:
        "from-blue-500 via-violet-500 to-fuchsia-500",
    },
    {
      key: "moviehub" as const,
      path: "/moviehub",
      label: "Media",
      title: "MovieHub (Watch by Request)",
      description:
        "Watch movies and series by placing a download request. Pick quality/seasons and let AI help with search and status.",
      highlights: ["Watch by request", "AI-powered assistance", "Download status"],
      icon: Clapperboard,
      iconGradient:
        "from-amber-500 via-orange-500 to-rose-500",
    },
  ];

  return (
    <div className="min-h-screen w-full landing-bg pt-20 sm:pt-24 pb-10 sm:pb-14 px-4 overflow-x-hidden">
      <div className="max-w-7xl mx-auto">
        <section className="relative overflow-hidden rounded-3xl border border-gray-200/70 dark:border-gray-700/60 glass-card p-5 sm:p-8 lg:p-10 animate-slide-up">
          <div className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-blue-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-14 h-60 w-60 rounded-full bg-fuchsia-500/20 blur-3xl" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-300/40 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-300">
              <Sparkles size={14} />
              Simple tools
            </div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-6 lg:gap-10 items-end">
              <div>
                <h1
                  className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.05] text-gray-900 dark:text-white"
                  style={{ fontFamily: '"Space Grotesk", "Segoe UI", sans-serif' }}
                >
                  A few useful tools,
                  <span className="bg-gradient-to-r from-blue-500 via-indigo-400 to-fuchsia-500 bg-clip-text text-transparent">
                    {" "}in one place
                  </span>
                </h1>
                <p className="mt-4 text-sm sm:text-base text-gray-600 dark:text-gray-300 max-w-2xl">
                  Track prices, manage coding prep, and use MovieHub to watch
                  movies/series by placing download requests with AI-powered help.
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => handleServiceClick("/moviehub", "moviehub")}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 text-white text-sm font-semibold hover:opacity-95 transition"
                  >
                    Open MovieHub
                    <ArrowRight size={16} />
                  </button>
                  <button
                    onClick={() => handleServiceClick("/pricetracker", "track")}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-semibold hover:bg-gray-100/80 dark:hover:bg-gray-800/60 transition"
                  >
                    Open Price Tracker
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {[
                  { label: "Tools", value: "3" },
                  { label: "Style", value: "Practical" },
                  { label: "Access", value: "Role based" },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-2xl border border-gray-200/70 dark:border-gray-700/70 bg-white/60 dark:bg-gray-900/30 px-3 py-4 text-center"
                  >
                    <p className="text-lg font-bold text-gray-900 dark:text-white">
                      {stat.value}
                    </p>
                    <p className="text-[11px] sm:text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 sm:mt-10">
          <div className="mb-4 sm:mb-5">
            <h2
              className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white"
              style={{ fontFamily: '"Space Grotesk", "Segoe UI", sans-serif' }}
            >
              Choose your workspace
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Pick the one you need and get started.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {tools.map((tool, index) => {
              const Icon = tool.icon;
              const isActive = activeTab === tool.key;
              return (
                <article
                  key={tool.key}
                  className={`animate-slide-up relative overflow-hidden rounded-2xl border p-5 sm:p-6 transition-all duration-300 glass-card ${
                    isActive
                      ? "border-blue-400/60 shadow-[0_0_0_1px_rgba(96,165,250,0.25),0_18px_40px_-18px_rgba(59,130,246,0.45)]"
                      : "border-gray-200 dark:border-gray-700 hover:-translate-y-0.5 hover:shadow-lg"
                  }`}
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-blue-400/60 to-transparent" />

                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={`w-12 h-12 rounded-xl bg-gradient-to-br ${tool.iconGradient} text-white flex items-center justify-center shadow-lg shadow-black/20`}
                    >
                      <Icon size={20} />
                    </div>
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                      {tool.label}
                    </span>
                  </div>

                  <h3 className="mt-4 text-xl font-bold text-gray-900 dark:text-white leading-snug">
                    {tool.title}
                  </h3>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 min-h-[68px]">
                    {tool.description}
                  </p>

                  <ul className="mt-4 space-y-1.5">
                    {tool.highlights.map((highlight) => (
                      <li
                        key={highlight}
                        className="text-xs text-gray-500 dark:text-gray-400"
                      >
                        • {highlight}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => handleServiceClick(tool.path, tool.key)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition"
                    >
                      Open
                      <ArrowRight size={14} />
                    </button>
                    {tool.key === "track" && (
                      <button
                        onClick={() => navigate("/pricetracker/dashboard")}
                        className="text-sm text-gray-500 dark:text-gray-400 underline underline-offset-2 hover:text-gray-700 dark:hover:text-gray-200"
                      >
                        Dashboard
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Landing;

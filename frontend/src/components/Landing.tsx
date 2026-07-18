import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  ArrowRight,
  ChartNoAxesCombined,
  Clapperboard,
  Code2,
  Flame,
  Gauge,
  MonitorOff,
  Plane,
  Play,
  ShieldCheck,
} from "lucide-react";
import { adminTools } from "../adminTools";

const tools = [
  {
    key: "speedtest",
    path: "/speedtest",
    title: "Speed Test",
    description: "Measure ping, download and upload",
    icon: Gauge,
    tone: "cyan",
    adminOnly: false,
    publicAccess: true,
  },
  {
    key: "buzzwatch",
    path: "/buzzwatch",
    title: "BuzzWatch",
    description: "Global movie and series buzz",
    icon: Flame,
    tone: "cyan",
    adminOnly: false,
    publicAccess: false,
  },
  {
    key: "moviehub",
    path: "/moviehub",
    title: "MovieHub",
    description: "Stream movies and series",
    icon: Clapperboard,
    tone: "violet",
    adminOnly: false,
    publicAccess: false,
  },
  {
    key: "track",
    path: "/pricetracker",
    title: "Amazon Tracker",
    description: "Track prices in real-time",
    icon: ChartNoAxesCombined,
    tone: "blue",
    adminOnly: false,
    publicAccess: false,
  },
  {
    key: "flights",
    path: "/flighttracker",
    title: "Flight Tracker",
    description: "Watch fares and get alerts",
    icon: Plane,
    tone: "cyan",
    adminOnly: false,
    publicAccess: false,
  },
  {
    key: "leetcode",
    path: "/leetcode",
    title: "LeetCode Manager",
    description: "Organize and practice",
    icon: Code2,
    tone: "amber",
    adminOnly: true,
    publicAccess: false,
  },
  {
    key: "remote",
    path: "/remote",
    title: "Remote",
    description: "Pause the Pi5 monitor render",
    icon: MonitorOff,
    tone: "amber",
    adminOnly: true,
    publicAccess: false,
  },
] as const;

export const Landing = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isAuthLoading, user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const visibleTools = tools.filter(({ adminOnly }) => !adminOnly || isAdmin);

  const openTool = (path: string, adminOnly = false, publicAccess = false) => {
    if (isAuthLoading) return;
    if (publicAccess) {
      navigate(path);
      return;
    }
    if (!isAuthenticated) {
      navigate("/login", { state: { from: path } });
      return;
    }
    if (adminOnly && !isAdmin) return;
    navigate(path);
  };

  const openAdminTool = (path: string) => {
    if (isAuthLoading || !isAuthenticated || !isAdmin) return;
    navigate(path);
  };

  return (
    <div className="portal-page min-h-screen px-4 pb-10 pt-24 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[1380px]">
        <section className="flex min-h-[350px] items-center">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-extrabold leading-[1.08] tracking-[-0.04em] text-white sm:text-5xl lg:text-[58px]">
              All your essential tools,
              <span className="block bg-gradient-to-r from-violet-500 via-fuchsia-400 to-blue-500 bg-clip-text text-transparent">
                in one place
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-6 text-slate-400 sm:text-base">
              Track prices, manage coding prep, and enjoy your media with a
              focused workspace built for speed.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <button
                onClick={() => openTool("/moviehub")}
                className="portal-primary-button"
              >
                <Play className="h-4 w-4 fill-current" />
                Open MovieHub
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => openTool("/flighttracker")}
                className="portal-secondary-button"
              >
                Track Flights
              </button>
            </div>
          </div>
        </section>

        <section className="mt-7">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-400">
                Workspace
              </p>
              <h2 className="mt-1 text-lg font-bold text-white">Your tools</h2>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {visibleTools.map(
              ({
                key,
                path,
                title,
                description,
                icon: Icon,
                tone,
                adminOnly,
                publicAccess,
              }) => (
                <button
                  key={key}
                  onClick={() => openTool(path, adminOnly, publicAccess)}
                  className="tool-card group text-left"
                >
                  <span className={`tool-card-icon tool-card-icon-${tone}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-white">
                      {title}
                    </span>
                    <span className="mt-1 block text-[11px] text-slate-500">
                      {description}
                    </span>
                  </span>
                  <span className="text-[11px] font-semibold text-violet-400 transition group-hover:translate-x-1">
                    Open -&gt;
                  </span>
                </button>
              )
            )}
          </div>
        </section>

        {isAdmin && (
          <section className="mt-10">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Admin only
                </p>
                <h2 className="mt-1 text-lg font-bold text-white">
                  Server applications
                </h2>
              </div>
              <span className="text-[11px] text-slate-500">
                Opens inside ToolHub
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {adminTools.map(
                ({ key, path, title, description, icon: Icon, tone }) => (
                  <button
                    key={key}
                    onClick={() => openAdminTool(path)}
                    className="tool-card group text-left"
                  >
                    <span className={`tool-card-icon tool-card-icon-${tone}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-white">
                        {title}
                      </span>
                      <span className="mt-1 block text-[11px] text-slate-500">
                        {description}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-violet-400 transition group-hover:translate-x-1" />
                  </button>
                )
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default Landing;

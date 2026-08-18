import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  AlertTriangle,
  ArrowRight,
  Cpu,
  CheckCheck,
  CircleAlert,
  Clock3,
  HardDrive,
  Info,
  MemoryStick,
  Network,
  Play,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import { adminTools } from "../adminTools";
import { serverAppLinks } from "../serverAppLinks";
import { TOOLS } from "../toolsRegistry";
import { requestJson } from "../utils/apiRequest";
import {
  NotificationService,
  type SiteNotification,
  type SiteNotificationSeverity,
} from "../apis/notifications/notifications";

const BASE_URL = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");

const severityTone: Record<SiteNotificationSeverity, string> = {
  INFO: "border-sky-400/25 bg-sky-400/10 text-sky-300",
  SUCCESS: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  WARNING: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  ERROR: "border-rose-400/25 bg-rose-400/10 text-rose-300",
  CRITICAL: "border-red-400/35 bg-red-500/15 text-red-200",
};

const severityIcon = (severity: SiteNotificationSeverity) => {
  if (severity === "WARNING") return AlertTriangle;
  if (severity === "ERROR" || severity === "CRITICAL") return CircleAlert;
  if (severity === "SUCCESS") return CheckCheck;
  return Info;
};

function relativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(value).toLocaleDateString();
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatStorage(gib: number): string {
  if (!gib) return "0 GB";
  if (gib >= 1024) return `${(gib / 1024).toFixed(1)} TB`;
  return `${Math.round(gib)} GB`;
}

interface ChartResponse {
  labels: string[];
  data: number[][];
}

interface SystemMetricsResponse {
  live: {
    uptimeSeconds: number;
    cpu: { percent: number };
    memory: { percent: number };
    disk: { percent: number; usedGiB: number; usableGiB: number };
  };
  charts: {
    cpu?: ChartResponse;
    memory?: ChartResponse;
    diskIo?: ChartResponse;
    network?: ChartResponse;
  };
  alarms: Array<{ name: string; status: string }>;
}

// Netdata returns each history chart as {labels: ["time", dim1, dim2, ...],
// data: [[timestamp, val1, val2, ...], ...]} newest-first — same shape
// SystemMetrics.tsx already parses. These turn that into the single-number
// series a sparkline needs, mirroring the same per-metric math the backend
// uses for the live snapshot (admin_routes.py current_metrics()).
function chartRows(chart?: ChartResponse): Record<string, number>[] {
  if (!chart?.labels?.length || !chart.data?.length) return [];
  return [...chart.data].reverse().map((values) =>
    chart.labels.reduce<Record<string, number>>((row, label, index) => {
      row[label] = Number(values[index] || 0);
      return row;
    }, {})
  );
}

const cpuSeries = (chart?: ChartResponse) =>
  chartRows(chart).map((row) => Math.max(0, Math.min(100, 100 - (row.idle || 0))));

const memorySeries = (chart?: ChartResponse) =>
  chartRows(chart).map((row) => {
    const total = (row.free || 0) + (row.used || 0) + (row.cached || 0) + (row.buffers || 0);
    return total > 0 ? (row.used / total) * 100 : 0;
  });

const diskIoSeries = (chart?: ChartResponse) =>
  chartRows(chart).map((row) => Math.abs(row.reads || 0) + Math.abs(row.writes || 0));

const networkSeries = (chart?: ChartResponse) =>
  chartRows(chart).map((row) => Math.abs(row.received || 0) + Math.abs(row.sent || 0));

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <div className="h-8 w-full" />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const width = 100;
  const height = 28;
  const step = width / (points.length - 1);
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${(index * step).toFixed(2)},${(height - ((point - min) / range) * height).toFixed(2)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-8 w-full" preserveAspectRatio="none">
      <path d={path} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const Landing = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isAuthLoading, user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const visibleTools = TOOLS.filter(({ adminOnly }) => !adminOnly || isAdmin);
  const serverApps = [...adminTools, ...serverAppLinks];

  const [notifications, setNotifications] = useState<SiteNotification[]>([]);
  const [metrics, setMetrics] = useState<SystemMetricsResponse | null>(null);
  const [metricsError, setMetricsError] = useState("");

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated) return;
    NotificationService.list(6)
      .then((feed) => setNotifications(feed.notifications || []))
      .catch(() => {});
  }, [isAuthLoading, isAuthenticated]);

  useEffect(() => {
    if (isAuthLoading || !isAdmin) return;
    requestJson<SystemMetricsResponse>(`${BASE_URL}/v2/admin/system-metrics`)
      .then((response) => {
        if (response.status === 200 && response.body) {
          setMetrics(response.body);
        } else {
          setMetricsError("Could not load system metrics.");
        }
      })
      .catch(() => setMetricsError("Could not load system metrics."));
  }, [isAuthLoading, isAdmin]);

  const openTool = (path: string) => navigate(path);

  const alarmCount = metrics?.alarms?.length ?? 0;
  const serverAppCount = serverApps.length;

  return (
    <div className="portal-page min-h-screen px-4 pb-10 pt-24 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[1380px]">
        {isAuthenticated ? (
          <section className="flex min-h-[140px] flex-col justify-center">
            <h1 className="text-3xl font-extrabold leading-tight tracking-[-0.03em] text-white sm:text-4xl">
              Welcome back, {user?.name?.split(" ")[0] || "there"} <span aria-hidden>👋</span>
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
              Everything you need, right where you need it.
            </p>
          </section>
        ) : (
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
                <button onClick={() => openTool("/moviehub")} className="portal-primary-button">
                  <Play className="h-4 w-4 fill-current" />
                  Open MovieHub
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button onClick={() => openTool("/flighttracker")} className="portal-secondary-button">
                  Track Flights
                </button>
              </div>
            </div>
          </section>
        )}

        {isAdmin && (
          <section className="mt-7">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 text-white">
                  <Clock3 className="h-4 w-4" />
                </span>
                <p className="mt-3 text-xs font-medium text-slate-400">Uptime</p>
                <p className="text-xl font-bold text-white">
                  {metrics ? formatUptime(metrics.live.uptimeSeconds) : "—"}
                </p>
              </div>
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-xl text-white ${
                    alarmCount > 0 ? "bg-gradient-to-br from-amber-500 to-orange-600" : "bg-gradient-to-br from-emerald-500 to-cyan-600"
                  }`}
                >
                  <ShieldCheck className="h-4 w-4" />
                </span>
                <p className="mt-3 text-xs font-medium text-slate-400">System Health</p>
                <p className="text-xl font-bold text-white">
                  {metrics ? (alarmCount > 0 ? `${alarmCount} warning${alarmCount === 1 ? "" : "s"}` : "Healthy") : "—"}
                </p>
              </div>
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 text-white">
                  <HardDrive className="h-4 w-4" />
                </span>
                <p className="mt-3 text-xs font-medium text-slate-400">Storage Used</p>
                <p className="text-xl font-bold text-white">
                  {metrics ? formatStorage(metrics.live.disk.usedGiB) : "—"}
                </p>
              </div>
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-violet-600 text-white">
                  <ServerCog className="h-4 w-4" />
                </span>
                <p className="mt-3 text-xs font-medium text-slate-400">Server Apps</p>
                <p className="text-xl font-bold text-white">{serverAppCount} configured</p>
              </div>
            </div>
            {metricsError && (
              <p className="mt-3 text-xs text-amber-400">{metricsError}</p>
            )}
          </section>
        )}

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
            {visibleTools.map(({ key, path, label, description, icon: Icon, tone }) => (
              <button key={key} onClick={() => openTool(path)} className="tool-card group text-left">
                <span className={`tool-card-icon tool-card-icon-${tone}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-white">{label}</span>
                  <span className="mt-1 block text-[11px] text-slate-500">{description}</span>
                </span>
                <span className="text-[11px] font-semibold text-violet-400 transition group-hover:translate-x-1">
                  Open -&gt;
                </span>
              </button>
            ))}
          </div>
        </section>

        {isAdmin && metrics && (
          <section className="mt-10">
            <div className="mb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-400">
                Real-time
              </p>
              <h2 className="mt-1 text-lg font-bold text-white">System overview</h2>
            </div>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                <p className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                  <Cpu className="h-3.5 w-3.5" /> CPU
                </p>
                <p className="mt-1 text-lg font-bold text-white">{metrics.live.cpu.percent.toFixed(0)}%</p>
                <Sparkline points={cpuSeries(metrics.charts.cpu)} />
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                <p className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                  <MemoryStick className="h-3.5 w-3.5" /> Memory
                </p>
                <p className="mt-1 text-lg font-bold text-white">{metrics.live.memory.percent.toFixed(0)}%</p>
                <Sparkline points={memorySeries(metrics.charts.memory)} />
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                <p className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                  <HardDrive className="h-3.5 w-3.5" /> Disk I/O
                </p>
                <p className="mt-1 text-lg font-bold text-white">{metrics.live.disk.percent.toFixed(0)}% used</p>
                <Sparkline points={diskIoSeries(metrics.charts.diskIo)} />
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                <p className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                  <Network className="h-3.5 w-3.5" /> Network
                </p>
                <p className="mt-1 text-lg font-bold text-white">
                  {(networkSeries(metrics.charts.network).slice(-1)[0] || 0).toFixed(0)} Kbps
                </p>
                <Sparkline points={networkSeries(metrics.charts.network)} />
              </div>
            </div>
          </section>
        )}

        {isAuthenticated && (
          <section className="mt-10">
            <div className="mb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-400">
                Latest
              </p>
              <h2 className="mt-1 text-lg font-bold text-white">Recent activity</h2>
            </div>
            <div className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02]">
              {notifications.length === 0 ? (
                <p className="p-5 text-sm text-slate-500">No recent activity.</p>
              ) : (
                notifications.map((notification) => {
                  const Icon = severityIcon(notification.severity);
                  return (
                    <div key={notification.notificationId} className="flex items-start gap-3 p-4">
                      <span className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border ${severityTone[notification.severity]}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{notification.title}</p>
                        <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{notification.message}</p>
                      </div>
                      <span className="flex-shrink-0 text-[11px] text-slate-500">{relativeTime(notification.createdAt)}</span>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        )}

        {isAdmin && (
          <section className="mt-10">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Admin only
                </p>
                <h2 className="mt-1 text-lg font-bold text-white">Server applications</h2>
              </div>
              <span className="text-[11px] text-slate-500">Opens inside ToolHub</span>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {serverApps.map(({ key, path, title, icon: Icon, tone }) => (
                <button key={key} onClick={() => openTool(path)} className="tool-card group text-left">
                  <span className={`tool-card-icon tool-card-icon-${tone}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-white">{title}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-violet-400 transition group-hover:translate-x-1" />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default Landing;

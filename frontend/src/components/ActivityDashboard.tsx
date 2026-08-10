import { Activity, MousePointerClick, ScrollText, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ActivitySummary, fetchActivitySummary, fetchLiveCount } from "../apis/activity/activity";

const number = new Intl.NumberFormat("en-IN");

const RANGE_OPTIONS = [
  { hours: 24, label: "Last 24 hours" },
  { hours: 168, label: "Last 7 days" },
  { hours: 720, label: "Last 30 days" },
];

const formatBucket = (bucket: string, hours: number) => {
  // "2026-08-10T14:00:00Z" -> "14:00" for short ranges, "08-10" for longer ones
  return hours > 48 ? bucket.slice(5, 10) : bucket.slice(11, 16);
};

const SCROLL_LABEL: Record<number, string> = { 25: "25%", 50: "50%", 75: "75%", 100: "100%" };

export default function ActivityDashboard() {
  const [hours, setHours] = useState(24);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [liveUsers, setLiveUsers] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    fetchActivitySummary(hours)
      .then((result) => !cancelled && setSummary(result))
      .catch((reason) => !cancelled && setError(reason instanceof Error ? reason.message : "Unable to load activity"));
    return () => {
      cancelled = true;
    };
  }, [hours]);

  useEffect(() => {
    let cancelled = false;
    const poll = () => fetchLiveCount().then((count) => !cancelled && setLiveUsers(count));
    poll();
    const timer = window.setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const scrollBuckets = useMemo(() => {
    const byDepth = new Map((summary?.scrollDepth || []).map((row) => [row.depth, row.count]));
    return [25, 50, 75, 100].map((depth) => ({ depth: SCROLL_LABEL[depth], count: byDepth.get(depth) || 0 }));
  }, [summary]);

  const cards = [
    { label: "Live now", value: liveUsers === null ? "…" : number.format(liveUsers), icon: Users },
    { label: "Unique users", value: summary ? number.format(summary.uniqueUsers) : "…", icon: Users },
    { label: "Pageviews", value: summary ? number.format(summary.pageviews) : "…", icon: Activity },
    { label: "Clicks", value: summary ? number.format(summary.clicks) : "…", icon: MousePointerClick },
  ];

  return (
    <div className="portal-page min-h-screen w-full px-4 pb-16 pt-24 sm:px-7">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Activity</h1>
            <p className="mt-2 text-sm text-slate-400">Live user count, pageviews, clicks, and scroll depth across ToolHub.</p>
          </div>
          <label>
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Range</span>
            <select
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
              className="w-full rounded-xl border border-white/10 bg-[#0b111d] px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-violet-400/40 sm:w-56"
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option.hours} value={option.hours}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        {error && <p className="mt-6 text-sm text-amber-300">{error}</p>}

        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cards.map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
              <Icon className="h-5 w-5 text-violet-300" />
              <p className="mt-5 text-3xl font-bold text-white">{value}</p>
              <p className="mt-1 text-xs text-slate-500">{label}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <h2 className="text-sm font-semibold text-white">Events over time</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={summary?.eventsOverTime || []}>
                <defs>
                  <linearGradient id="activityEvents" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tick={{ fill: "#64748b", fontSize: 10 }}
                  tickFormatter={(value) => formatBucket(value, hours)}
                  axisLine={false}
                />
                <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "#0b111d", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12 }}
                  labelFormatter={(value) => formatBucket(String(value), hours)}
                />
                <Area type="monotone" dataKey="count" name="Events" stroke="#a78bfa" fill="url(#activityEvents)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            <h2 className="text-sm font-semibold text-white">Top pages</h2>
            <div className="mt-4 space-y-2">
              {(summary?.topPages || []).length ? summary!.topPages.map((row) => (
                <div key={row.path} className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-black/10 p-3">
                  <p className="truncate text-sm text-slate-200">{row.path}</p>
                  <p className="shrink-0 text-sm font-bold text-violet-200">{number.format(row.count)}</p>
                </div>
              )) : <p className="text-sm text-slate-500">No pageviews in this range yet.</p>}
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            <h2 className="text-sm font-semibold text-white">Top clicked elements</h2>
            <div className="mt-4 space-y-2">
              {(summary?.topClicks || []).length ? summary!.topClicks.map((row, index) => (
                <div key={`${row.path}-${row.target}-${index}`} className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-black/10 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-200">{row.target}</p>
                    <p className="truncate text-[11px] text-slate-500">{row.path}</p>
                  </div>
                  <p className="shrink-0 text-sm font-bold text-violet-200">{number.format(row.count)}</p>
                </div>
              )) : <p className="text-sm text-slate-500">No clicks in this range yet.</p>}
            </div>
          </section>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-violet-300" />
            <h2 className="text-sm font-semibold text-white">Scroll depth</h2>
          </div>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={scrollBuckets}>
                <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                <XAxis dataKey="depth" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} />
                <Tooltip contentStyle={{ background: "#0b111d", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12 }} />
                <Bar dataKey="count" name="Sessions" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

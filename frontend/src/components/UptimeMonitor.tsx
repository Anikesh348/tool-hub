import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Server,
  XCircle,
} from "lucide-react";
import {
  fetchUptimeOverview,
  type UptimeEndpoint,
  type UptimeOverview,
} from "../apis/admin/uptime";

const formatMs = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(1)} ms`;

const UptimeMonitor = () => {
  const [overview, setOverview] = useState<UptimeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    try {
      setOverview(await fetchUptimeOverview());
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Uptime data is unavailable");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const groups = useMemo(() => {
    const next = new Map<string, UptimeEndpoint[]>();
    for (const endpoint of overview?.endpoints || []) {
      next.set(endpoint.group, [...(next.get(endpoint.group) || []), endpoint]);
    }
    return [...next.entries()];
  }, [overview]);

  const healthy = overview?.endpoints.filter((endpoint) => endpoint.healthy).length || 0;
  const total = overview?.endpoints.length || 0;
  const averageResponse = total
    ? (overview?.endpoints.reduce((sum, endpoint) => sum + endpoint.lastResponseMs, 0) || 0) / total
    : 0;

  if (loading && !overview) {
    return <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Loading uptime data...</div>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#070b13] p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Service health</h2>
            <p className="mt-1 text-xs text-slate-500">Live Gatus results, refreshed every 30 seconds</p>
          </div>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-violet-400/50 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Healthy", value: `${healthy}/${total}`, icon: CheckCircle2, color: "text-emerald-300" },
            { label: "Unavailable", value: String(total - healthy), icon: XCircle, color: "text-red-300" },
            { label: "Average response", value: formatMs(averageResponse), icon: Clock3, color: "text-blue-300" },
            { label: "Groups", value: String(groups.length), icon: Server, color: "text-violet-300" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-xs text-slate-500"><Icon className={`h-4 w-4 ${color}`} />{label}</div>
              <div className="mt-2 text-2xl font-bold text-white">{value}</div>
            </div>
          ))}
        </div>

        {groups.map(([group, endpoints]) => (
          <section key={group} className="space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-violet-300" />
              <h3 className="text-sm font-bold text-white">{group}</h3>
              <span className="text-xs text-slate-600">{endpoints.length} checks</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {endpoints.map((endpoint) => (
                <article key={endpoint.key} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-semibold text-white">{endpoint.name}</h4>
                      <p className="mt-1 truncate text-[11px] text-slate-600">
                        {endpoint.lastCheckedAt ? new Date(endpoint.lastCheckedAt).toLocaleString() : "Not checked yet"}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${endpoint.healthy ? "bg-emerald-400/10 text-emerald-300" : "bg-red-400/10 text-red-300"}`}>
                      {endpoint.healthy ? "Healthy" : "Down"}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-black/20 p-2"><div className="text-[10px] text-slate-600">Uptime</div><div className="mt-1 text-xs font-semibold text-slate-200">{endpoint.uptimePercent.toFixed(2)}%</div></div>
                    <div className="rounded-lg bg-black/20 p-2"><div className="text-[10px] text-slate-600">Latest</div><div className="mt-1 text-xs font-semibold text-slate-200">{formatMs(endpoint.lastResponseMs)}</div></div>
                    <div className="rounded-lg bg-black/20 p-2"><div className="text-[10px] text-slate-600">Average</div><div className="mt-1 text-xs font-semibold text-slate-200">{formatMs(endpoint.averageResponseMs)}</div></div>
                  </div>
                  {endpoint.errors.length > 0 && <p className="mt-3 line-clamp-2 text-[11px] text-red-300">{endpoint.errors.join("; ")}</p>}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export default UptimeMonitor;

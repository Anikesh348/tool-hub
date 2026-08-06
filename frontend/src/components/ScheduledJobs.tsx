import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Cpu,
  RefreshCw,
  XCircle,
} from "lucide-react";
import {
  fetchSchedulerRuns,
  type ScheduledJobRun,
} from "../apis/admin/scheduler";

const STATUS_BADGE: Record<ScheduledJobRun["status"], string> = {
  success: "bg-emerald-400/10 text-emerald-300",
  warning: "bg-amber-400/10 text-amber-300",
  failure: "bg-red-400/10 text-red-300",
};

const formatTime = (value: string) => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const formatDuration = (startedAt: string, finishedAt: string) => {
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";
  const seconds = (end - start) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
};

const ScheduledJobs = () => {
  const [runs, setRuns] = useState<ScheduledJobRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedJob, setSelectedJob] = useState<string>("all");

  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    try {
      const result = await fetchSchedulerRuns();
      setRuns(result.runs || []);
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Scheduled job history is unavailable",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const jobs = useMemo(
    () => [...new Set(runs.map((run) => run.job))].sort(),
    [runs],
  );

  const visibleRuns = useMemo(
    () => (selectedJob === "all" ? runs : runs.filter((run) => run.job === selectedJob)),
    [runs, selectedJob],
  );

  const counts = useMemo(
    () => ({
      success: runs.filter((run) => run.status === "success").length,
      warning: runs.filter((run) => run.status === "warning").length,
      failure: runs.filter((run) => run.status === "failure").length,
    }),
    [runs],
  );

  if (loading && !runs.length) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Loading scheduled job history...
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#070b13] p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Scheduled jobs</h2>
            <p className="mt-1 text-xs text-slate-500">
              Run history from the opsched scheduler on ubuntu-purva
            </p>
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
          <div className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Total runs", value: String(runs.length), icon: CalendarClock, color: "text-violet-300" },
            { label: "Success", value: String(counts.success), icon: CheckCircle2, color: "text-emerald-300" },
            { label: "Warning", value: String(counts.warning), icon: AlertTriangle, color: "text-amber-300" },
            { label: "Failure", value: String(counts.failure), icon: XCircle, color: "text-red-300" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Icon className={`h-4 w-4 ${color}`} />
                {label}
              </div>
              <div className="mt-2 text-2xl font-bold text-white">{value}</div>
            </div>
          ))}
        </div>

        {jobs.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {["all", ...jobs].map((job) => (
              <button
                key={job}
                type="button"
                onClick={() => setSelectedJob(job)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  selectedJob === job
                    ? "bg-violet-500/20 text-violet-200"
                    : "border border-white/10 text-slate-400 hover:text-white"
                }`}
              >
                {job === "all" ? "All jobs" : job}
              </button>
            ))}
          </div>
        )}

        {visibleRuns.length === 0 ? (
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-6 text-center text-sm text-slate-500">
            No scheduled job runs recorded yet.
          </div>
        ) : (
          <div className="space-y-3">
            {visibleRuns.map((run) => (
              <article
                key={`${run.job}-${run.startedAt}`}
                className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-white">{run.job}</h3>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${STATUS_BADGE[run.status]}`}
                      >
                        {run.status}
                      </span>
                      {run.provider && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-400/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-blue-300">
                          <Cpu className="h-3 w-3" />
                          {run.provider}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-slate-400">{run.summary}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[11px] text-slate-500">{formatTime(run.startedAt)}</div>
                    <div className="mt-1 text-[11px] text-slate-600">
                      {formatDuration(run.startedAt, run.finishedAt)} · {run.host}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ScheduledJobs;

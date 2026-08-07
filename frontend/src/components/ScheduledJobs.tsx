import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Cpu,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Save,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  fetchSchedulerJobs,
  fetchSchedulerRuns,
  setJobEnabled,
  updateJobSchedule,
  type ScheduledJobRun,
  type SchedulerJob,
} from "../apis/admin/scheduler";

const STATUS_BADGE: Record<ScheduledJobRun["status"], string> = {
  success: "bg-emerald-400/10 text-emerald-300",
  warning: "bg-amber-400/10 text-amber-300",
  failure: "bg-red-400/10 text-red-300",
};

const jobLabel = (slug: string) =>
  slug
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");

const formatTime = (value: string | null) => {
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
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
};

const JobDetail = ({
  job,
  onChanged,
}: {
  job: SchedulerJob;
  onChanged: () => void;
}) => {
  const [runs, setRuns] = useState<ScheduledJobRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState("");
  const [scheduleInput, setScheduleInput] = useState(job.scheduleValue || "");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState("");

  useEffect(() => {
    setScheduleInput(job.scheduleValue || "");
    setSaveMessage("");
    setSaveError("");
    setToggleError("");
  }, [job.slug, job.scheduleValue]);

  useEffect(() => {
    let cancelled = false;
    setRunsLoading(true);
    fetchSchedulerRuns(job.historyKey)
      .then((result) => {
        if (!cancelled) {
          setRuns(result.runs || []);
          setRunsError("");
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setRunsError(err.message);
      })
      .finally(() => {
        if (!cancelled) setRunsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [job.historyKey]);

  const handleSaveSchedule = async () => {
    if (!scheduleInput.trim() || scheduleInput === job.scheduleValue) return;
    setSaving(true);
    setSaveMessage("");
    setSaveError("");
    try {
      const result = await updateJobSchedule(job.slug, scheduleInput.trim());
      setSaveMessage(result.preview || "Schedule updated.");
      onChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not update schedule");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async () => {
    setToggling(true);
    setToggleError("");
    try {
      await setJobEnabled(job.slug, !job.enabled);
      onChanged();
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : "Could not update job state");
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Disable "${jobLabel(job.slug)}"? It stops running until re-enabled.`)) return;
    setToggling(true);
    setToggleError("");
    try {
      await setJobEnabled(job.slug, false);
      onChanged();
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : "Could not disable job");
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">{jobLabel(job.slug)}</h2>
          <p className="mt-1 text-xs text-slate-500">{job.description}</p>
          <p className="mt-1 text-[11px] text-slate-600">
            {job.timer} → {job.service}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleEnabled}
            disabled={toggling}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-violet-400/50 hover:text-white disabled:opacity-50"
          >
            {toggling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : job.enabled ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {job.enabled ? "Disable" : "Enable"}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={toggling || !job.enabled}
            className="inline-flex items-center gap-2 rounded-lg border border-red-400/20 px-3 py-2 text-xs font-semibold text-red-300 transition hover:border-red-400/50 hover:text-red-200 disabled:opacity-50"
            title="Disables the job. Nothing is deleted from disk."
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>
      {toggleError && (
        <div className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          {toggleError}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
          <div className="text-xs text-slate-500">State</div>
          <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${job.enabled ? "bg-emerald-400/10 text-emerald-300" : "bg-slate-400/10 text-slate-400"}`}>
            {job.enabled ? "Enabled" : "Disabled"}
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
          <div className="text-xs text-slate-500">Next run</div>
          <div className="mt-2 text-sm font-semibold text-white">{job.nextRun || "—"}</div>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
          <div className="text-xs text-slate-500">Last run (systemd)</div>
          <div className="mt-2 text-sm font-semibold text-white">{job.lastRun || "—"}</div>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <CalendarClock className="h-4 w-4 text-violet-300" />
          Schedule ({job.scheduleDirective || "unknown"})
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={scheduleInput}
            onChange={(event) => setScheduleInput(event.target.value)}
            className="flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-violet-400/50"
            placeholder={job.scheduleDirective === "OnCalendar" ? "*-*-* 03:30:00 Asia/Kolkata" : "2min"}
          />
          <button
            type="button"
            onClick={handleSaveSchedule}
            disabled={saving || !scheduleInput.trim() || scheduleInput === job.scheduleValue}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-500/20 px-4 py-2 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/30 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-600">
          {job.scheduleDirective === "OnCalendar"
            ? "systemd calendar expression, validated before saving."
            : "systemd time span (e.g. 2min, 30s), validated before saving."}
        </p>
        {saveMessage && (
          <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-emerald-400/10 px-3 py-2 text-[11px] text-emerald-200">
            {saveMessage}
          </pre>
        )}
        {saveError && (
          <div className="mt-3 rounded-lg bg-red-400/10 px-3 py-2 text-xs text-red-200">{saveError}</div>
        )}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-bold text-white">Run history</h3>
        {runsLoading && <p className="text-xs text-slate-500">Loading history...</p>}
        {runsError && (
          <div className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            {runsError}
          </div>
        )}
        {!runsLoading && !runsError && runs.length === 0 && (
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-6 text-center text-sm text-slate-500">
            No runs recorded yet.
          </div>
        )}
        {!runsLoading && runs.length > 0 && (
          <div className="space-y-2">
            {runs.map((run) => (
              <article
                key={`${run.job}-${run.startedAt}`}
                className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_BADGE[run.status]}`}>
                      {run.status}
                    </span>
                    {run.provider && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-300">
                        <Cpu className="h-3 w-3" />
                        {run.provider}
                      </span>
                    )}
                    <span className="text-[11px] text-slate-500">{formatTime(run.startedAt)}</span>
                    <span className="text-[11px] text-slate-600">
                      ({formatDuration(run.startedAt, run.finishedAt)})
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-400">{run.summary}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const ScheduledJobs = () => {
  const [jobs, setJobs] = useState<SchedulerJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    try {
      const result = await fetchSchedulerJobs();
      setJobs(result.jobs || []);
      setError("");
      setSelectedSlug((current) => current ?? result.jobs?.[0]?.slug ?? null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Scheduled jobs are unavailable");
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

  const selectedJob = useMemo(
    () => jobs.find((job) => job.slug === selectedSlug) || null,
    [jobs, selectedSlug],
  );

  if (loading && !jobs.length) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Loading scheduled jobs...
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#070b13] sm:flex-row">
      <div className="w-full shrink-0 border-white/[0.07] p-4 sm:w-72 sm:border-r sm:p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">Scheduled Jobs</h2>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing}
            className="rounded-lg border border-white/10 p-1.5 text-slate-400 transition hover:border-violet-400/50 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
        {error && (
          <div className="mb-3 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}
        <div className="space-y-2">
          {jobs.map((job) => (
            <button
              key={job.slug}
              type="button"
              onClick={() => setSelectedSlug(job.slug)}
              className={`w-full rounded-xl border p-3 text-left transition ${
                selectedSlug === job.slug
                  ? "border-violet-400/50 bg-violet-500/10"
                  : "border-white/[0.07] bg-white/[0.02] hover:border-white/20"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white">{jobLabel(job.slug)}</span>
                {job.enabled ? (
                  job.active ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
                  )
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-slate-500" />
                )}
              </div>
              <p className="mt-1 truncate text-[11px] text-slate-500">
                Next: {job.nextRun ? job.nextRun.split(" ").slice(0, 5).join(" ") : "—"}
              </p>
            </button>
          ))}
        </div>
      </div>
      {selectedJob ? (
        <JobDetail job={selectedJob} onChanged={() => load(true)} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
          Select a job to see its details.
        </div>
      )}
    </div>
  );
};

export default ScheduledJobs;

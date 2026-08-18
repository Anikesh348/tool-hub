import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Server,
  ShieldAlert,
} from "lucide-react";
import { refreshAccessToken } from "../apis/auth/authSession";
import { useAuth } from "../context/AuthContext";
import { formatIstDateTime, formatIstDay } from "../utils/formatIst";

type Severity = "critical" | "error" | "warning";

type Digest = {
  schemaVersion: number;
  reportDate: string;
  generatedAt: string;
  window: {
    start: string;
    end: string;
    hours: number;
  };
  overallStatus: "critical" | "error" | "warning" | "partial" | "ok";
  summary: {
    linesAnalyzed: number;
    importantLines: number;
    critical: number;
    error: number;
    warning: number;
    sources: number;
    sourcesHealthy: number;
  };
  executiveSummary: string;
  priorityFindings: Array<{
    severity: Severity;
    category: string;
    count: number;
    title: string;
    sources: string[];
    additionalSourceCount: number;
    impact: string;
    recommendedAction: string;
  }>;
  sources: Array<{
    id: string;
    label: string;
    kind: string;
    status: string;
    linesAnalyzed: number;
    importantLines: number;
    note: string;
  }>;
  notes: string[];
};

type DigestDay = {
  date: string;
  generatedAt: string;
  overallStatus: Digest["overallStatus"];
  summary: Digest["summary"];
};

const API_BASE = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");

const severityStyles: Record<Severity, string> = {
  critical: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  error: "border-orange-500/30 bg-orange-500/10 text-orange-200",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-100",
};

const formatDate = formatIstDateTime;

const formatDay = formatIstDay;

const number = new Intl.NumberFormat();

const LogDigest = () => {
  const { authToken } = useAuth();
  const [digest, setDigest] = useState<Digest | null>(null);
  const [days, setDays] = useState<DigestDay[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDigest = useCallback(async (date = "") => {
    if (!authToken) return;
    setLoading(true);
    try {
      setError("");
      const query = date ? `?date=${encodeURIComponent(date)}` : "";
      const send = () =>
        fetch(`${API_BASE}/v2/admin/log-digest${query}`, {
          credentials: "include",
        });
      let response = await send();
      if (response.status === 401 && (await refreshAccessToken())) {
        response = await send();
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || `Log digest request failed (${response.status})`);
      }
      setDigest((await response.json()) as Digest);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The log digest is unavailable",
      );
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;
    const loadDays = async () => {
      try {
        const send = () =>
          fetch(`${API_BASE}/v2/admin/log-digest/days`, {
            credentials: "include",
          });
        let response = await send();
        if (response.status === 401 && (await refreshAccessToken())) {
          response = await send();
        }
        if (!response.ok) return;
        const payload = (await response.json()) as { days?: DigestDay[] };
        const nextDays = payload.days || [];
        setDays(nextDays);
        const firstDate = nextDays[0]?.date || "";
        setSelectedDate(firstDate);
        await loadDigest(firstDate);
      } catch {
        await loadDigest();
      }
    };
    loadDays();
  }, [authToken, loadDigest]);

  const selectDay = (date: string) => {
    if (date === selectedDate) return;
    setSelectedDate(date);
    loadDigest(date);
  };

  const refresh = async () => {
    await loadDigest(selectedDate);
  };

  const unavailableSources = useMemo(
    () => digest?.sources.filter((source) => source.status !== "ok") || [],
    [digest],
  );

  const coverage = useMemo(() => {
    if (!digest) return { ubuntu: 0, homeAssistant: 0 };
    return digest.sources.reduce(
      (totals, source) => {
        if (source.kind.startsWith("homeassistant")) {
          totals.homeAssistant += 1;
        } else {
          totals.ubuntu += 1;
        }
        return totals;
      },
      { ubuntu: 0, homeAssistant: 0 },
    );
  }, [digest]);

  if (loading && !digest) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-500">
        Loading the latest digest...
      </div>
    );
  }

  if (error && !digest) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <AlertCircle className="h-9 w-9 text-rose-300" />
        <div>
          <h2 className="font-bold text-white">Digest unavailable</h2>
          <p className="mt-1 text-sm text-slate-400">{error}</p>
        </div>
        <button
          type="button"
          onClick={() => loadDigest(selectedDate)}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </button>
      </div>
    );
  }

  if (!digest) return null;

  const cards = [
    {
      label: "Sources reviewed",
      value: number.format(digest.summary.sources),
      detail: `${digest.summary.sourcesHealthy} collected successfully`,
      icon: Server,
      color: "text-violet-300",
    },
    {
      label: "Entries inspected",
      value: number.format(digest.summary.linesAnalyzed),
      detail: "Analyzed, not displayed",
      icon: CheckCircle2,
      color: "text-cyan-300",
    },
    {
      label: "Priority findings",
      value: number.format(digest.priorityFindings.length),
      detail: "Consolidated conclusions",
      icon: AlertTriangle,
      color: "text-amber-300",
    },
    {
      label: "Critical findings",
      value: number.format(
        digest.priorityFindings.filter((finding) => finding.severity === "critical")
          .length,
      ),
      detail: "Requires prompt review",
      icon: ShieldAlert,
      color: "text-rose-300",
    },
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#070b13] px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  digest.overallStatus === "ok"
                    ? "bg-emerald-400"
                    : digest.overallStatus === "partial"
                      ? "bg-slate-400"
                      : "bg-amber-400"
                }`}
              />
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                {digest.overallStatus}
              </p>
            </div>
            <h2 className="mt-2 text-2xl font-bold text-white">
              {formatDay(digest.reportDate)}
            </h2>
            <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              <Clock3 className="h-3.5 w-3.5" />
              Generated {formatDate(digest.generatedAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        <section className="mt-6 rounded-2xl border border-white/[0.08] bg-[#0a101c] p-4">
          <div className="mb-3 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-violet-300" />
            <div>
              <h3 className="text-sm font-bold text-white">Daily history</h3>
              <p className="text-[10px] text-slate-500">
                Summary-only reports retained for 90 days
              </p>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {days.map((day) => (
              <button
                key={day.date}
                type="button"
                onClick={() => selectDay(day.date)}
                className={`min-w-[150px] rounded-xl border p-3 text-left transition ${
                  selectedDate === day.date
                    ? "border-violet-400/50 bg-violet-500/15"
                    : "border-white/[0.07] bg-black/20 hover:border-white/20"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-white">
                    {formatDay(day.date)}
                  </span>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      day.overallStatus === "ok"
                        ? "bg-emerald-400"
                        : day.overallStatus === "partial"
                          ? "bg-slate-400"
                          : "bg-amber-400"
                    }`}
                  />
                </div>
                <p className="mt-2 text-[10px] text-slate-500">
                  {number.format(day.summary.critical)} critical ·{" "}
                  {number.format(day.summary.error)} errors
                </p>
              </button>
            ))}
          </div>
        </section>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(({ label, value, detail, icon: Icon, color }) => (
            <div
              key={label}
              className="rounded-2xl border border-white/[0.08] bg-[#0a101c] p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                    {label}
                  </p>
                  <p className="mt-2 text-2xl font-bold text-white">{value}</p>
                  <p className="mt-1 text-xs text-slate-500">{detail}</p>
                </div>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
            </div>
          ))}
        </div>

        <section className="mt-6 overflow-hidden rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/[0.12] via-[#0a101c] to-[#0a101c] p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
              <ShieldAlert className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-300">
                Executive summary
              </p>
              <p className="mt-3 max-w-4xl text-base font-medium leading-7 text-slate-100">
                {digest.executiveSummary}
              </p>
              <p className="mt-3 text-xs text-slate-500">
                Based on all {number.format(digest.summary.linesAnalyzed)} entries
                reviewed for this day. No individual log entries are displayed.
              </p>
            </div>
          </div>
        </section>

        {unavailableSources.length > 0 && (
          <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] p-4">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
              <div>
                <h3 className="text-sm font-bold text-amber-100">
                  Some sources were not collected
                </h3>
                <div className="mt-2 space-y-1 text-xs text-amber-100/70">
                  {unavailableSources.map((source) => (
                    <p key={source.id}>
                      <span className="font-semibold">{source.label}:</span>{" "}
                      {source.note || source.status}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.7fr_1fr]">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Critical details and highlights
                </h3>
                <p className="mt-1 text-[10px] text-slate-500">
                  Consolidated across every affected source
                </p>
              </div>
              <span className="text-xs text-slate-500">
                {digest.priorityFindings.length} findings
              </span>
            </div>
            <div className="space-y-3">
              {digest.priorityFindings.length === 0 ? (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] p-6 text-center">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" />
                  <p className="mt-2 text-sm font-bold text-emerald-100">
                    No critical details require attention
                  </p>
                </div>
              ) : (
                digest.priorityFindings.map((finding) => (
                  <article
                    key={`${finding.severity}-${finding.title}`}
                    className="rounded-2xl border border-white/[0.08] bg-[#0a101c] p-4"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${severityStyles[finding.severity]}`}
                      >
                        {finding.severity}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-bold text-slate-100">
                          {finding.title}
                        </h4>
                        <p className="mt-1 text-xs text-slate-500">
                          {finding.sources.join(", ")}
                          {finding.additionalSourceCount > 0
                            ? ` and ${finding.additionalSourceCount} more`
                            : ""}
                        </p>
                        <p className="mt-3 text-xs leading-5 text-slate-300">
                          {finding.impact}
                        </p>
                        <div className="mt-3 rounded-xl bg-black/20 px-3 py-2.5">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-300">
                            Recommended check
                          </p>
                          <p className="mt-1 text-xs leading-5 text-slate-400">
                            {finding.recommendedAction}
                          </p>
                        </div>
                        <p className="mt-2 text-[10px] text-slate-600">
                          {number.format(finding.count)} related events consolidated
                        </p>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-bold text-white">Review coverage</h3>
            <div className="rounded-2xl border border-white/[0.08] bg-[#0a101c] p-4">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">Ubuntu</span>
                    <span className="text-slate-500">
                      {coverage.ubuntu} sources
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-slate-600">
                    System journal and every Docker container
                  </p>
                </div>
                <div className="border-t border-white/[0.06] pt-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">
                      Home Assistant
                    </span>
                    <span className="text-slate-500">
                      {coverage.homeAssistant} sources
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-slate-600">
                    Core, Supervisor, host services and installed apps
                  </p>
                </div>
                <div className="border-t border-white/[0.06] pt-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">
                      Collection health
                    </span>
                    <span
                      className={
                        digest.summary.sourcesHealthy === digest.summary.sources
                          ? "text-emerald-300"
                          : "text-amber-300"
                      }
                    >
                      {digest.summary.sourcesHealthy}/{digest.summary.sources}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-slate-600">
                    Sources successfully included in this summary
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-1 text-[10px] leading-4 text-slate-600">
              {digest.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default LogDigest;

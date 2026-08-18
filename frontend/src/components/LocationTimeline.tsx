import { Clock, Compass, Download, MapPin, Route, TimerReset } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useTheme } from "../context/ThemeContext";
import {
  fetchLocationRoute,
  fetchLocationSummary,
  LocationRange,
  LocationRoute,
  LocationSummary,
} from "../apis/location/location";
import { formatIstDateTime, formatIstTime, todayIst } from "../utils/formatIst";
import { formatMinutes, LocationRangeControl, StatCard, StayAvatar } from "./LocationShared";
import LocationRouteMap from "./LocationRouteMap";

const DONUT_COLORS = ["#8b5cf6", "#3b82f6", "#14b8a6", "#f59e0b", "#ec4899", "#64748b"];

const downloadCsv = (summary: LocationSummary) => {
  const rows = [...summary.stays].reverse();
  const header = ["Place", "Arrived (IST)", "Departed (IST)", "Stay (min)", "From", "Travel (min)", "Travel distance (km)"];
  const lines = rows.map((stay) => [
    stay.label,
    formatIstDateTime(stay.arrivedAt),
    stay.departedAt ? formatIstDateTime(stay.departedAt) : "Ongoing",
    String(stay.durationMinutes),
    stay.fromLabel || "",
    stay.travelMinutes != null ? String(stay.travelMinutes) : "",
    stay.travelDistanceKm != null ? String(stay.travelDistanceKm) : "",
  ]);
  const csv = [header, ...lines]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `location-timeline-${summary.range}${summary.date ? `-${summary.date}` : ""}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

export default function LocationTimeline() {
  const { theme } = useTheme();
  const [range, setRange] = useState<LocationRange>("today");
  const [date, setDate] = useState(todayIst());
  const [summary, setSummary] = useState<LocationSummary | null>(null);
  const [route, setRoute] = useState<LocationRoute | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    fetchLocationSummary(range, range === "day" ? date : undefined)
      .then((result) => !cancelled && setSummary(result))
      .catch((reason) => !cancelled && setError(reason instanceof Error ? reason.message : "Unable to load location data"));
    fetchLocationRoute(range, range === "day" ? date : undefined).then((result) => !cancelled && setRoute(result));
    return () => {
      cancelled = true;
    };
  }, [range, date]);

  const journeyStops = useMemo(() => (summary ? [...summary.stays].reverse() : []), [summary]);

  const totalTimeMinutes = summary
    ? Math.round((new Date(summary.rangeEnd).getTime() - new Date(summary.rangeStart).getTime()) / 60000)
    : 0;

  const travelStats = useMemo(() => {
    const withTravel = (summary?.stays || []).filter((stay) => stay.travelMinutes);
    const totalTravelMinutes = withTravel.reduce((sum, stay) => sum + (stay.travelMinutes || 0), 0);
    return { totalTravelMinutes, transitions: withTravel.length };
  }, [summary]);

  const longestStay = useMemo(() => {
    const stays = summary?.stays || [];
    if (!stays.length) return null;
    return stays.reduce((longest, stay) => (stay.durationMinutes > longest.durationMinutes ? stay : longest), stays[0]);
  }, [summary]);

  const showDate = range === "week" || range === "month";

  return (
    <div className="portal-page min-h-screen w-full px-4 pb-16 pt-24 sm:px-7">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Movement Timeline</h1>
            <p className="mt-2 text-sm text-slate-400">A detailed timeline of your movements and time spent across places.</p>
          </div>
          <LocationRangeControl range={range} date={date} onChangeRange={setRange} onChangeDate={setDate} />
        </div>

        {error && <p className="mt-6 text-sm text-amber-300">{error}</p>}

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">Journey Summary</h2>
            <p className="text-xs text-slate-500">
              {journeyStops.length} stops &middot; {summary?.totalDistanceKm ?? "…"} km &middot; {formatMinutes(totalTimeMinutes)}
            </p>
          </div>
          <div className="mt-4 flex items-start gap-0 overflow-x-auto pb-1">
            {journeyStops.map((stay, index) => (
              <div className="flex items-center" key={`${stay.arrivedAt}-${index}`}>
                {index > 0 && <div className="mx-1 h-px w-8 shrink-0 border-t border-dashed border-white/15 sm:w-14" />}
                <div className="flex w-20 shrink-0 flex-col items-center text-center">
                  <StayAvatar zone={stay.zone} />
                  <p className="mt-1.5 max-w-[80px] truncate text-[11px] font-semibold text-slate-800 dark:text-slate-200">{stay.label}</p>
                  <p className="text-[10px] text-slate-500">{formatIstTime(stay.arrivedAt)}</p>
                </div>
              </div>
            ))}
            {!journeyStops.length && <p className="text-sm text-slate-500">No stops recorded in this range yet.</p>}
          </div>
        </div>

        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-white">Route Map</h2>
          <LocationRouteMap points={route?.points || []} path={route?.path || []} stays={summary?.stays || []} />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard icon={Clock} label="Total time" value={formatMinutes(totalTimeMinutes)} />
          <StatCard icon={Route} label="Total distance" value={summary ? `${summary.totalDistanceKm} km` : "…"} />
          <StatCard icon={MapPin} label="Total stops" value={summary ? String(summary.stays.length) : "…"} />
          <StatCard
            icon={TimerReset}
            label={`Travel time · across ${travelStats.transitions} transitions`}
            value={formatMinutes(travelStats.totalTravelMinutes)}
          />
          <StatCard
            icon={Clock}
            label={longestStay ? `Longest stay · ${longestStay.label}` : "Longest stay"}
            value={longestStay ? formatMinutes(longestStay.durationMinutes) : "…"}
          />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            <h2 className="text-sm font-semibold text-white">Timeline</h2>
            <div className="relative mt-4">
              {(summary?.stays.length || 0) > 1 && (
                <div className="pointer-events-none absolute left-[6.6rem] top-6 bottom-6 w-px bg-white/10 sm:left-[6.9rem]" />
              )}
              <div>
                {(summary?.stays || []).length ? summary!.stays.map((stay, index) => {
                  const nextStay = summary!.stays[index + 1]; // chronologically earlier - the place they left to get here
                  const timeFormat = showDate ? formatIstDateTime : formatIstTime;
                  return (
                  <div key={`${stay.arrivedAt}-${index}`}>
                    <div className="relative flex flex-wrap items-start gap-3 py-3 sm:flex-nowrap sm:gap-4">
                      <div className="w-20 shrink-0 pt-2 text-right text-[11px] leading-tight text-slate-500 sm:w-24">
                        {timeFormat(stay.arrivedAt)}
                      </div>
                      <div className="relative z-10 shrink-0 rounded-full ring-4 ring-[#f8fafc] dark:ring-[#060b14]">
                        <StayAvatar zone={stay.zone} />
                      </div>
                      <div className="min-w-0 flex-1 pt-1.5">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{stay.label}</p>
                        {stay.address && <p className="truncate text-[11px] text-slate-500">{stay.address}</p>}
                        <p className="mt-1 truncate text-[11px] text-slate-500">
                          Entered {formatIstTime(stay.arrivedAt)}
                          {!stay.current && stay.departedAt ? <> &middot; Left {formatIstTime(stay.departedAt)}</> : null}
                        </p>
                      </div>
                      <div className="shrink-0 rounded-lg bg-violet-500/15 px-2.5 py-1.5 text-center">
                        <p className="text-xs font-bold text-violet-700 dark:text-violet-200">
                          {stay.current ? "Ongoing" : formatMinutes(stay.durationMinutes)}
                        </p>
                        <p className="text-[9px] uppercase tracking-wide text-violet-500/80 dark:text-violet-400/80">Stay</p>
                      </div>
                    </div>
                    {nextStay && stay.travelMinutes ? (
                      <div className="relative flex items-center gap-2.5 py-1.5 pl-[5.6rem] sm:pl-[6.6rem]">
                        <Compass className="relative z-10 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
                        <p className="truncate text-[11px] text-slate-500">
                          Traveling {formatMinutes(stay.travelMinutes)}
                          {stay.travelDistanceKm ? ` · ${stay.travelDistanceKm} km` : ""}
                          {nextStay.departedAt ? ` · ${formatIstTime(nextStay.departedAt)} → ${formatIstTime(stay.arrivedAt)}` : ""}
                        </p>
                      </div>
                    ) : null}
                  </div>
                  );
                }) : <p className="mt-2 text-sm text-slate-500">No stays recorded in this range yet.</p>}
              </div>
              {(summary?.stays.length || 0) > 0 && (
                <p className="mt-4 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                  Start of timeline
                </p>
              )}
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
              <h2 className="text-sm font-semibold text-white">Time Breakdown</h2>
              <div className="mt-2 h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={summary?.zoneBreakdown || []}
                      dataKey="minutes"
                      nameKey="label"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={2}
                    >
                      {(summary?.zoneBreakdown || []).map((_, index) => (
                        <Cell key={index} fill={DONUT_COLORS[index % DONUT_COLORS.length]} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: theme === "dark" ? "#0b111d" : "#ffffff",
                        border: theme === "dark" ? "1px solid rgba(255,255,255,.1)" : "1px solid rgba(148,163,184,.3)",
                        borderRadius: 12,
                        color: theme === "dark" ? "#e2e8f0" : "#0f172a",
                      }}
                      formatter={(value: number, name: string) => [formatMinutes(value), name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 space-y-1.5">
                {(summary?.zoneBreakdown || []).map((row, index) => {
                  const total = (summary?.zoneBreakdown || []).reduce((sum, r) => sum + r.minutes, 0) || 1;
                  return (
                    <div key={row.zone} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                        <span className="h-2 w-2 rounded-full" style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] }} />
                        {row.label}
                      </span>
                      <span className="text-slate-500">
                        {formatMinutes(row.minutes)} ({Math.round((row.minutes / total) * 100)}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
              <h2 className="text-sm font-semibold text-white">Export Timeline</h2>
              <p className="mt-1 text-xs text-slate-500">Download your timeline and trip data for this range as CSV.</p>
              <button
                type="button"
                disabled={!summary}
                onClick={() => summary && downloadCsv(summary)}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-white/5 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:text-violet-200"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

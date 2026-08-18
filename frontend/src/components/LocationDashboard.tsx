import { Check, Clock, MapPinPlus, Navigation, Pencil, Route, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTheme } from "../context/ThemeContext";
import {
  createLocationPlace,
  fetchLocationCurrent,
  fetchLocationPlaces,
  fetchLocationSummary,
  LocationCurrentStatus,
  LocationPlace,
  LocationRange,
  LocationSummary,
  percentDelta,
  renameLocationPlace,
} from "../apis/location/location";
import { formatIstTime, todayIst } from "../utils/formatIst";
import { formatMinutes, LocationRangeControl, StatCard, StayAvatar } from "./LocationShared";

export default function LocationDashboard() {
  const { theme } = useTheme();
  const [range, setRange] = useState<LocationRange>("today");
  const [date, setDate] = useState(todayIst());
  const [summary, setSummary] = useState<LocationSummary | null>(null);
  const [current, setCurrent] = useState<LocationCurrentStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    fetchLocationSummary(range, range === "day" ? date : undefined)
      .then((result) => !cancelled && setSummary(result))
      .catch((reason) => !cancelled && setError(reason instanceof Error ? reason.message : "Unable to load location data"));
    return () => {
      cancelled = true;
    };
  }, [range, date]);

  useEffect(() => {
    let cancelled = false;
    const poll = () => fetchLocationCurrent().then((status) => !cancelled && setCurrent(status));
    poll();
    const timer = window.setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const [places, setPlaces] = useState<LocationPlace[]>([]);
  const loadPlaces = () => fetchLocationPlaces().then(setPlaces).catch(() => undefined);
  useEffect(() => {
    loadPlaces();
  }, []);

  const chartData = (summary?.zoneBreakdown || []).map((row) => ({
    label: row.label,
    hours: Math.round((row.minutes / 60) * 10) / 10,
  }));

  const topZones = (summary?.zoneBreakdown || []).slice(0, 2);
  const rangeLabel = range === "day" ? "day" : range === "today" ? "today" : range === "week" ? "week" : "month";

  return (
    <div className="portal-page min-h-screen w-full px-4 pb-16 pt-24 sm:px-7">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Location Activity</h1>
            <p className="mt-2 text-sm text-slate-400">Your movement summary and insights across places.</p>
          </div>
          <LocationRangeControl range={range} date={date} onChangeRange={setRange} onChangeDate={setDate} />
        </div>

        {error && <p className="mt-6 text-sm text-amber-300">{error}</p>}

        <div className="mt-6 flex items-center gap-4 rounded-2xl border border-violet-400/20 bg-gradient-to-r from-violet-500/10 via-white/[0.035] to-white/[0.035] p-5">
          <StayAvatar zone={current?.zone ?? null} size="h-14 w-14" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-600 dark:text-emerald-400">Live</span>
            </div>
            <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
              {current ? <>Currently at <span className="text-violet-300">{current.zoneLabel}</span></> : "Loading current location…"}
            </p>
            {current?.since && (
              <p className="mt-0.5 text-xs text-slate-500">Since {formatIstTime(current.since)}</p>
            )}
          </div>
          <Link
            to="/admin/location/timeline"
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-500/10 px-3.5 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-500/20"
          >
            <Navigation className="h-3.5 w-3.5" />
            View Timeline
          </Link>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            icon={Navigation}
            label={`Total trips vs previous ${rangeLabel}`}
            value={summary ? String(summary.totalTrips) : "…"}
            deltaPct={summary ? percentDelta(summary.totalTrips, summary.previousTotalTrips) : undefined}
          />
          <StatCard
            icon={Route}
            label={`Distance vs previous ${rangeLabel}`}
            value={summary ? `${summary.totalDistanceKm} km` : "…"}
            deltaPct={summary ? percentDelta(summary.totalDistanceKm, summary.previousTotalDistanceKm) : undefined}
          />
          {topZones.map((row) => (
            <StatCard
              key={row.zone}
              icon={Clock}
              label={`Time at ${row.label} vs previous ${rangeLabel}`}
              value={formatMinutes(row.minutes)}
              deltaPct={summary ? percentDelta(row.minutes, summary.previousZoneMinutes[row.zone] || 0) : undefined}
            />
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <h2 className="text-sm font-semibold text-white">Time by place</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} />
                <YAxis allowDecimals tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} unit="h" />
                <Tooltip
                  contentStyle={{
                    background: theme === "dark" ? "#0b111d" : "#ffffff",
                    border: theme === "dark" ? "1px solid rgba(255,255,255,.1)" : "1px solid rgba(148,163,184,.3)",
                    borderRadius: 12,
                    color: theme === "dark" ? "#e2e8f0" : "#0f172a",
                  }}
                  formatter={(value: number) => [`${value}h`, "Time"]}
                />
                <Bar dataKey="hours" name="Hours" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Recent activity</h2>
            <Link to="/admin/location/timeline" className="text-xs font-semibold text-violet-300 hover:text-violet-200">
              View all
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {(summary?.stays || []).length ? summary!.stays.slice(0, 6).map((stay, index) => (
              <div
                key={`${stay.arrivedAt}-${index}`}
                className="flex items-center gap-3 rounded-xl border border-white/5 bg-black/10 p-3"
              >
                <StayAvatar zone={stay.zone} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-800 dark:text-slate-200">
                    {stay.fromLabel ? (
                      <>{stay.fromLabel} <span className="text-slate-500">&rarr;</span> {stay.label}</>
                    ) : stay.label}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">
                    {stay.travelDistanceKm ? `${stay.travelDistanceKm} km · ` : ""}
                    {formatMinutes(stay.durationMinutes)} stay
                  </p>
                </div>
                <p className="shrink-0 text-xs text-slate-500">{formatIstTime(stay.arrivedAt)}</p>
              </div>
            )) : <p className="text-sm text-slate-500">No activity recorded in this range yet.</p>}
          </div>
        </section>

        <PlacesSection places={places} current={current} onChanged={loadPlaces} />
      </div>
    </div>
  );
}

// Any stop away from home/office longer than ~10 minutes gets auto-tagged
// here via reverse geocoding - this lets you fix a wrong or generic label
// (e.g. a street name instead of "Gym"), or add your current spot manually
// without waiting for the 10-minute threshold.
function PlacesSection({
  places,
  current,
  onChanged,
}: {
  places: LocationPlace[];
  current: LocationCurrentStatus | null;
  onChanged: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingLabel, setAddingLabel] = useState<string | null>(null);
  const [addError, setAddError] = useState("");

  const startEdit = (place: LocationPlace) => {
    setEditingId(place._id);
    setDraft(place.label);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
  };

  const save = async (placeId: string) => {
    const label = draft.trim();
    if (!label) return;
    setSaving(true);
    try {
      await renameLocationPlace(placeId, label);
      onChanged();
      cancelEdit();
    } catch {
      // leave the row in edit mode so the user can retry
    } finally {
      setSaving(false);
    }
  };

  const canAddCurrent = current?.latitude != null && current?.longitude != null;

  const addCurrentLocation = async () => {
    const label = (addingLabel || "").trim();
    if (!label || !canAddCurrent) return;
    setAddError("");
    try {
      await createLocationPlace(label, current!.latitude!, current!.longitude!);
      onChanged();
      setAddingLabel(null);
    } catch {
      setAddError("Couldn't save that place - try again.");
    }
  };

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Places</h2>
          <p className="mt-1 text-xs text-slate-500">Auto-tagged from stops away from home/office. Rename any that got labeled wrong.</p>
        </div>
        {addingLabel === null ? (
          <button
            type="button"
            disabled={!canAddCurrent}
            onClick={() => setAddingLabel("")}
            title={canAddCurrent ? "Add your current location as a place" : "Waiting for a location fix…"}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-white/5 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:text-violet-200"
          >
            <MapPinPlus className="h-3.5 w-3.5" />
            Add current location
          </button>
        ) : (
          <div className="flex shrink-0 items-center gap-1.5">
            <input
              autoFocus
              value={addingLabel}
              onChange={(event) => setAddingLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addCurrentLocation();
                if (event.key === "Escape") setAddingLabel(null);
              }}
              placeholder="Name this place"
              className="w-40 rounded-lg border border-white/10 bg-[#0b111d] px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-violet-400/40"
            />
            <button
              type="button"
              onClick={addCurrentLocation}
              className="rounded-lg border border-white/10 p-1.5 text-emerald-300 hover:bg-white/5"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setAddingLabel(null)}
              className="rounded-lg border border-white/10 p-1.5 text-slate-400 hover:bg-white/5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      {addError && <p className="mt-2 text-xs text-amber-300">{addError}</p>}

      {!places.length ? (
        <p className="mt-4 text-sm text-slate-500">
          No places tagged yet. They'll show up automatically once you spend 10+ minutes somewhere new, or add your current spot above.
        </p>
      ) : (
      <div className="mt-4 space-y-2">
        {places.map((place) => (
          <div
            key={place._id}
            className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-black/10 p-3"
          >
            {editingId === place._id ? (
              <>
                <input
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") save(place._id);
                    if (event.key === "Escape") cancelEdit();
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0b111d] px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-violet-400/40"
                />
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => save(place._id)}
                    className="rounded-lg border border-white/10 p-1.5 text-emerald-300 hover:bg-white/5 disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="rounded-lg border border-white/10 p-1.5 text-slate-400 hover:bg-white/5"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-800 dark:text-slate-200">{place.label}</p>
                  <p className="truncate text-[11px] text-slate-500">
                    {place.source === "manual" ? "Manually named" : "Auto-tagged"} &middot; {place.address || `${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(place)}
                  className="shrink-0 rounded-lg border border-white/10 p-1.5 text-slate-400 hover:bg-white/5 hover:text-violet-200"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      )}
    </section>
  );
}

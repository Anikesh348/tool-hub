import { Briefcase, CalendarDays, ChevronLeft, ChevronRight, Compass, Home, LucideIcon, MapPin, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LocationRange, LocationStayKind, stayKind } from "../apis/location/location";
import { formatIstDay, todayIst } from "../utils/formatIst";

export const RANGE_OPTIONS: { range: LocationRange; label: string }[] = [
  { range: "today", label: "Today" },
  { range: "week", label: "This week" },
  { range: "month", label: "This month" },
  { range: "day", label: "Custom day" },
];

export const formatMinutes = (minutes: number) => {
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hrs <= 0) return `${mins}m`;
  return `${hrs}h ${mins}m`;
};

const KIND_STYLE: Record<LocationStayKind, { icon: LucideIcon; wrap: string; icn: string }> = {
  home: { icon: Home, wrap: "bg-violet-500/15 border-violet-400/30", icn: "text-violet-300" },
  office: { icon: Briefcase, wrap: "bg-blue-500/15 border-blue-400/30", icn: "text-blue-300" },
  place: { icon: MapPin, wrap: "bg-teal-500/15 border-teal-400/30", icn: "text-teal-300" },
  traveling: { icon: Compass, wrap: "bg-amber-500/15 border-amber-400/30", icn: "text-amber-300" },
  zone: { icon: MapPin, wrap: "bg-slate-500/15 border-slate-400/30", icn: "text-slate-300" },
  unknown: { icon: MapPin, wrap: "bg-slate-500/15 border-slate-400/30", icn: "text-slate-400" },
};

export function StayAvatar({ zone, size = "h-10 w-10" }: { zone: string | null; size?: string }) {
  const { icon: Icon, wrap, icn } = KIND_STYLE[stayKind(zone)];
  return (
    <div className={`flex ${size} shrink-0 items-center justify-center rounded-full border ${wrap}`}>
      <Icon className={`h-4 w-4 ${icn}`} />
    </div>
  );
}

export function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null || pct === 0) return null;
  const up = pct > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(pct)}%
    </span>
  );
}

const MONTH_LABEL_FORMAT = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const pad2 = (n: number) => String(n).padStart(2, "0");

function CalendarPopover({
  value,
  max,
  onSelect,
  onClose,
}: {
  value: string;
  max: string;
  onSelect: (date: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [selY, selM, selD] = value.split("-").map(Number);
  const [maxY, maxM, maxD] = max.split("-").map(Number);
  const maxDateNum = maxY * 10000 + maxM * 100 + maxD;
  const [viewYear, setViewYear] = useState(selY);
  const [viewMonth, setViewMonth] = useState(selM);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [onClose]);

  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const atMaxMonth = viewYear === maxY && viewMonth === maxM;

  const goPrevMonth = () => {
    if (viewMonth === 1) {
      setViewMonth(12);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };
  const goNextMonth = () => {
    if (atMaxMonth) return;
    if (viewMonth === 12) {
      setViewMonth(1);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  return (
    <div
      ref={ref}
      className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-300/40 dark:border-white/10 dark:bg-[#0b111d] dark:shadow-black/40"
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={goPrevMonth}
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-semibold text-slate-900 dark:text-white">{MONTH_LABEL_FORMAT.format(new Date(viewYear, viewMonth - 1, 1))}</p>
        <button
          type="button"
          onClick={goNextMonth}
          disabled={atMaxMonth}
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-600">
        {WEEKDAY_LABELS.map((label, index) => (
          <span key={index}>{label}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (day === null) return <span key={`blank-${index}`} />;
          const dateNum = viewYear * 10000 + viewMonth * 100 + day;
          const disabled = dateNum > maxDateNum;
          const isSelected = viewYear === selY && viewMonth === selM && day === selD;
          const isToday = dateNum === maxDateNum;
          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(`${viewYear}-${pad2(viewMonth)}-${pad2(day)}`)}
              className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-medium transition ${
                isSelected
                  ? "bg-violet-500 text-white"
                  : isToday
                  ? "border border-violet-400/40 text-violet-700 dark:text-violet-200"
                  : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
              } ${disabled ? "cursor-not-allowed opacity-25 hover:bg-transparent" : ""}`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LocationRangeControl({
  range,
  date,
  onChangeRange,
  onChangeDate,
}: {
  range: LocationRange;
  date: string;
  onChangeRange: (range: LocationRange) => void;
  onChangeDate: (date: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label>
        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Range</span>
        <select
          value={range}
          onChange={(event) => onChangeRange(event.target.value as LocationRange)}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-violet-400/40 dark:border-white/10 dark:bg-[#0b111d] dark:text-slate-200 sm:w-40"
        >
          {RANGE_OPTIONS.map((option) => (
            <option key={option.range} value={option.range}>{option.label}</option>
          ))}
        </select>
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          title="Pick a specific day"
          className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
            range === "day"
              ? "border-violet-400/40 bg-violet-500/15 text-violet-700 dark:text-violet-200"
              : "border-slate-300 bg-white text-slate-600 hover:border-violet-400/30 hover:text-violet-700 dark:border-white/10 dark:bg-[#0b111d] dark:text-slate-300 dark:hover:text-violet-200"
          }`}
        >
          <CalendarDays className="h-4 w-4" />
          {range === "day" && formatIstDay(date)}
        </button>
        {pickerOpen && (
          <CalendarPopover
            value={date}
            max={todayIst()}
            onSelect={(picked) => {
              onChangeDate(picked);
              onChangeRange("day");
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  deltaPct,
  deltaLabel,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  deltaPct?: number | null;
  deltaLabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.035]">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15">
        <Icon className="h-4.5 w-4.5 text-violet-600 dark:text-violet-300" />
      </div>
      <p className="mt-5 text-3xl font-bold text-slate-900 dark:text-white">{value}</p>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
        <span>{label}</span>
        {deltaPct !== undefined && <DeltaBadge pct={deltaPct} />}
        {deltaLabel && deltaPct ? <span className="text-slate-500 dark:text-slate-600">{deltaLabel}</span> : null}
      </div>
    </div>
  );
}

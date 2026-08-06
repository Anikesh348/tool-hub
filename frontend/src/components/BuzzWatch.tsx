import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarRange,
  Check,
  CheckCircle2,
  Clock3,
  Flame,
  Clapperboard,
  Info,
  Pencil,
  RefreshCw,
  Send,
  Search,
  Sparkles,
  Star,
  ShieldAlert,
  Tv,
  UserRound,
  Users,
  X,
} from "lucide-react";
import {
  BuzzWatchGenre,
  BuzzWatchItem,
  BuzzWatchMediaType,
  BuzzWatchMode,
  BuzzWatchMovieHubAccess,
  BuzzWatchPerson,
  BuzzWatchPersonCreditsResponse,
  BuzzWatchPreference,
  BuzzWatchResponse,
  BuzzWatchService,
  BuzzWatchTitleDetails,
} from "../apis/buzzwatch/buzzwatch";
import { Loader } from "./Loader";

const FALLBACK_POSTER =
  "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=700&q=80";

const formatDate = (value?: string, year?: string) => {
  if (!value) return year || "Release TBA";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const formatUpdated = (value?: string) => {
  if (!value) return "Waiting for first refresh";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waiting for first refresh";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const ratingLabel = (item: BuzzWatchItem) => {
  if (typeof item.rtScore === "number") return `${item.rtScore}% RT`;
  if (typeof item.imdbRating === "number") return `${item.imdbRating.toFixed(1)} IMDb`;
  if (typeof item.tmdbRating === "number") return `${item.tmdbRating.toFixed(1)} TMDB`;
  return "Rating pending";
};

const mediaLabel = (mediaType: BuzzWatchItem["mediaType"]) =>
  mediaType === "movie" ? "Movie" : "Series";

const staticYears = () => {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: currentYear - 1980 + 1 }, (_, index) => String(currentYear - index));
};

const scoreTone = (score?: number) => {
  if ((score || 0) >= 85) return "bg-emerald-300 text-slate-950";
  if ((score || 0) >= 70) return "bg-cyan-300 text-slate-950";
  if ((score || 0) >= 55) return "bg-amber-300 text-slate-950";
  return "bg-white/[0.08] text-slate-200";
};

const GenrePicker: React.FC<{
  genres: BuzzWatchGenre[];
  selectedGenres: string[];
  onChange: (values: string[]) => void;
}> = ({ genres, selectedGenres, onChange }) => {
  const allGenreKeys = useMemo(() => genres.map((genre) => genre.key), [genres]);
  const toggleGenre = (key: string) => {
    onChange(
      selectedGenres.includes(key)
        ? selectedGenres.filter((item) => item !== key)
        : [...selectedGenres, key],
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Sparkles className="h-4 w-4 text-cyan-200" />
          Genres
          <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] text-slate-300">
            {selectedGenres.length}/{genres.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onChange(allGenreKeys)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-slate-200 transition hover:border-cyan-300/50"
          >
            Select all
          </button>
          <button
            onClick={() => onChange([])}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-slate-400 transition hover:border-rose-300/50 hover:text-rose-200"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="flex max-h-72 flex-wrap gap-2 overflow-auto pr-1">
        {genres.map((genre) => {
          const active = selectedGenres.includes(genre.key);
          return (
            <button
              key={genre.key}
              onClick={() => toggleGenre(genre.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                active
                  ? "border-cyan-300/70 bg-cyan-300 text-slate-950"
                  : "border-white/10 bg-slate-950/50 text-slate-300 hover:border-white/25"
              }`}
            >
              {active && <Check className="h-3 w-3" />}
              {genre.name}
            </button>
          );
        })}
      </div>
    </div>
  );
};

const Onboarding: React.FC<{
  genres: BuzzWatchGenre[];
  selectedGenres: string[];
  saving: boolean;
  error: string | null;
  onChange: (values: string[]) => void;
  onSave: () => void;
}> = ({ genres, selectedGenres, saving, error, onChange, onSave }) => (
  <div className="portal-page flex min-h-screen items-center px-4 pb-12 pt-24 sm:px-6 lg:px-10">
    <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="rounded-2xl border border-white/10 bg-slate-950/80 p-6 shadow-2xl shadow-black/25 sm:p-8">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-bold text-cyan-200">
          <Flame className="h-3.5 w-3.5" />
          BuzzWatch setup
        </span>
        <h1 className="mt-5 text-3xl font-extrabold leading-tight text-white sm:text-5xl">
          Tell BuzzWatch what you actually like.
        </h1>
        <p className="mt-4 text-sm leading-6 text-slate-400 sm:text-base">
          Pick as many genres as you want. ToolHub will save this to your profile and use it to score every movie or series out of 100.
        </p>
        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
            What happens next
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Your second screen becomes a personalized buzz board with recent releases, year filters, and quick preference editing.
          </p>
        </div>
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-xl shadow-black/10 sm:p-6">
        <GenrePicker genres={genres} selectedGenres={selectedGenres} onChange={onChange} />
        {error && <p className="mt-4 text-sm font-semibold text-rose-300">{error}</p>}
        <button
          onClick={onSave}
          disabled={saving || selectedGenres.length === 0}
          className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-400 px-5 text-sm font-black text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving..." : "Build my suggestions"}
        </button>
      </section>
    </div>
  </div>
);

const ItemCard: React.FC<{
  item: BuzzWatchItem;
  compact?: boolean;
  canRequest: boolean;
  requestState?: "idle" | "loading" | "PENDING" | "APPROVED" | "error";
  onRequest: (item: BuzzWatchItem) => void;
  onDetails: (item: BuzzWatchItem) => void;
}> = ({
  item,
  compact = false,
  canRequest,
  requestState = "idle",
  onRequest,
  onDetails,
}) => {
  const backdrop = item.backdropUrl || item.posterUrl || FALLBACK_POSTER;
  const poster = item.posterUrl || backdrop;

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-slate-950/70 shadow-xl shadow-black/20 transition-colors hover:border-cyan-300/40">
      <div className={`relative ${compact ? "h-36" : "h-48"} overflow-hidden bg-slate-900`}>
        <img
          src={backdrop}
          alt=""
          className="h-full w-full object-cover opacity-75 transition-opacity duration-300 group-hover:opacity-90"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/25 to-transparent" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-extrabold ${scoreTone(item.buzzScore)}`}>
            <Flame className="h-3 w-3" />
            Buzz {Math.round(item.buzzScore || 0)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[11px] font-bold text-white backdrop-blur">
            {item.matchScore || 0}% taste
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[11px] font-bold text-white backdrop-blur">
            {item.mediaType === "movie" ? <Sparkles className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
            {mediaLabel(item.mediaType)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400 px-2 py-1 text-[11px] font-extrabold text-slate-950">
            <Star className="h-3 w-3 fill-current" />
            {ratingLabel(item)}
          </span>
        </div>
        <div className="absolute bottom-3 left-3 right-3 flex items-end gap-3">
          <img
            src={poster}
            alt=""
            className="hidden h-20 w-14 rounded-md border border-white/20 object-cover shadow-lg sm:block"
            loading="lazy"
          />
          <div className="min-w-0">
            <button
              onClick={() => onDetails(item)}
              className="line-clamp-2 text-left text-base font-extrabold text-white transition hover:text-cyan-200"
            >
              {item.title}
            </button>
            <p className="mt-1 text-xs font-medium text-slate-300">
              {item.releaseContext || "Released"} · {formatDate(item.releaseDate, item.year)}
            </p>
            {item.creditCharacters?.length ? (
              <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-cyan-200">
                as {item.creditCharacters.join(" / ")}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        {item.providers?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {item.providers.slice(0, 4).map((provider) => (
              <span key={provider.providerId} className="inline-flex items-center gap-1.5 rounded-full bg-sky-300/10 px-2 py-1 text-[11px] font-bold text-sky-100">
                {provider.logoUrl ? <img src={provider.logoUrl} alt="" className="h-4 w-4 rounded object-cover" loading="lazy" /> : null}
                {provider.name}
              </span>
            ))}
            {item.providers.length > 4 ? (
              <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[11px] font-semibold text-slate-400">+{item.providers.length - 4}</span>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          {item.genres.slice(0, 4).map((genre) => (
            <span
              key={genre}
              className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                genre === "Steamy"
                  ? "bg-rose-300/15 text-rose-200"
                  : "bg-white/[0.06] text-slate-300"
              }`}
            >
              {genre}
            </span>
          ))}
        </div>
        {!compact && (
          <>
            {item.recommendationReasons?.[0] ? (
              <p className="line-clamp-2 rounded-lg border border-cyan-300/10 bg-cyan-300/[0.05] px-3 py-2 text-xs font-semibold leading-5 text-cyan-100">
                {item.recommendationLabel || "Recommended"} · {item.recommendationReasons[0]}
              </p>
            ) : null}
            <p className="line-clamp-3 text-sm leading-6 text-slate-400">
              {item.overview || "Synopsis is still under wraps."}
            </p>
          </>
        )}
        <div className="mt-auto grid grid-cols-[auto_minmax(0,1fr)] gap-2 pt-1">
        <button
          onClick={() => onDetails(item)}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/10 px-3 text-xs font-black text-slate-200 transition hover:border-cyan-300/50 hover:text-white"
          title="View title details"
        >
          <Info className="h-3.5 w-3.5" />
          Details
        </button>
        <button
          onClick={() => onRequest(item)}
          disabled={!canRequest || requestState === "loading" || requestState === "PENDING" || requestState === "APPROVED"}
          className={`inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border px-3 text-xs font-black transition ${
            requestState === "APPROVED"
              ? "border-emerald-300/40 bg-emerald-300 text-slate-950"
              : requestState === "PENDING"
                ? "border-amber-300/40 bg-amber-300 text-slate-950"
                : canRequest
                  ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300 hover:text-slate-950"
                  : "cursor-not-allowed border-white/10 bg-white/[0.03] text-slate-500"
          }`}
          title={canRequest ? "Request in MovieHub" : "Connect MovieHub to request titles"}
        >
          {requestState === "loading" ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : requestState === "APPROVED" ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : requestState === "PENDING" ? (
            <Clock3 className="h-3.5 w-3.5" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {requestState === "APPROVED"
            ? "Approved"
            : requestState === "PENDING"
              ? "Requested"
              : requestState === "loading"
                ? "Requesting..."
                : requestState === "error"
                  ? "Try again"
                  : canRequest
                    ? "Request in MovieHub"
                    : "MovieHub required"}
        </button>
        </div>
      </div>
    </article>
  );
};

const severityTone = (severity: string) => {
  if (severity === "SEVERE") return "bg-rose-300 text-slate-950";
  if (severity === "MODERATE") return "bg-amber-300 text-slate-950";
  if (severity === "MILD") return "bg-cyan-300 text-slate-950";
  if (severity === "NONE") return "bg-emerald-300 text-slate-950";
  return "bg-white/[0.08] text-slate-300";
};

const TitleDetailsModal: React.FC<{
  item: BuzzWatchItem;
  details: BuzzWatchTitleDetails | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}> = ({ item, details, loading, error, onClose }) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const backdrop = details?.backdropUrl || item.backdropUrl || item.posterUrl || FALLBACK_POSTER;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`${item.title} details`}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-t-xl border border-white/10 bg-slate-950 shadow-2xl sm:rounded-xl">
        <div className="relative min-h-52 overflow-hidden border-b border-white/10">
          <img src={backdrop} alt="" className="absolute inset-0 h-full w-full object-cover opacity-45" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/55 to-slate-950/20" />
          <button
            onClick={onClose}
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 bg-black/50 text-white backdrop-blur transition hover:bg-black/80"
            aria-label="Close details"
            title="Close details"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-200">
              <span className="rounded-full bg-white/10 px-2.5 py-1">{mediaLabel(item.mediaType)}</span>
              {(details?.certification || details?.runtimeMinutes) && (
                <span className="rounded-full bg-white/10 px-2.5 py-1">
                  {[details?.certification, details?.runtimeMinutes ? `${details.runtimeMinutes} min` : null].filter(Boolean).join(" • ")}
                </span>
              )}
              {details?.numberOfSeasons ? (
                <span className="rounded-full bg-white/10 px-2.5 py-1">{details.numberOfSeasons} seasons</span>
              ) : null}
            </div>
            <h2 className="mt-3 text-2xl font-black text-white sm:text-4xl">{details?.title || item.title}</h2>
            {details?.tagline ? <p className="mt-2 text-sm font-semibold text-cyan-200">{details.tagline}</p> : null}
          </div>
        </div>

        {loading ? (
          <div className="py-16"><Loader /></div>
        ) : error ? (
          <div className="p-8 text-center text-sm font-semibold text-rose-300">{error}</div>
        ) : details ? (
          <div className="space-y-8 p-5 sm:p-7">
            {item.buzzBreakdown ? (
              <section className="grid gap-4 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.05] p-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-200">Buzz rating</p>
                  <p className="mt-1 text-5xl font-black text-white">{Math.round(item.buzzScore || 0)}<span className="text-lg text-slate-500">/100</span></p>
                  <p className="mt-1 text-xs font-semibold text-slate-400">{item.buzzConfidence || "early"} confidence</p>
                </div>
                <div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {[
                      ["Quality", item.buzzBreakdown.quality],
                      ["Audience", item.buzzBreakdown.audience],
                      ["Momentum", item.buzzBreakdown.momentum],
                      ["Freshness", item.buzzBreakdown.freshness],
                      ["Access", item.buzzBreakdown.availability],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-lg bg-slate-950/60 p-2 text-center">
                        <p className="text-[10px] font-bold uppercase text-slate-500">{label}</p>
                        <p className="mt-1 text-lg font-black text-white">{value}</p>
                      </div>
                    ))}
                  </div>
                  <ul className="mt-3 space-y-1 text-xs font-semibold text-slate-300">
                    {(item.recommendationReasons || item.buzzReasons || []).map((reason) => <li key={reason}>• {reason}</li>)}
                  </ul>
                </div>
              </section>
            ) : null}
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
              <div>
                <p className="text-sm leading-7 text-slate-300">{details.overview || "No synopsis is available yet."}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {details.genres.map((genre) => (
                    <span key={genre} className="rounded-full bg-white/[0.07] px-2.5 py-1 text-xs font-bold text-slate-300">{genre}</span>
                  ))}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div><dt className="text-xs font-bold uppercase text-slate-500">Released</dt><dd className="mt-1 font-semibold text-white">{formatDate(details.releaseDate)}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-slate-500">Rating</dt><dd className="mt-1 font-semibold text-white">{details.rating ? `${details.rating.toFixed(1)} TMDB` : "Not rated"}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-slate-500">Status</dt><dd className="mt-1 font-semibold text-white">{details.status || "Unknown"}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-slate-500">By</dt><dd className="mt-1 font-semibold text-white">{details.creators.join(", ") || "Not listed"}</dd></div>
              </dl>
            </div>

            <section>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-cyan-300" />
                <h3 className="text-base font-black text-white">Cast</h3>
              </div>
              {details.cast.length ? (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {details.cast.map((person) => (
                    <div key={`${person.personId}-${person.character}`} className="flex min-w-0 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-2">
                      <div className="flex h-12 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/[0.06] text-slate-500">
                        {person.profileUrl ? <img src={person.profileUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <UserRound className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0"><p className="truncate text-xs font-black text-white">{person.name}</p><p className="mt-1 truncate text-[11px] text-slate-400">{person.character || "Cast"}</p></div>
                    </div>
                  ))}
                </div>
              ) : <p className="mt-3 text-sm text-slate-500">Cast information is not available.</p>}
            </section>

            <section>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-amber-300" /><h3 className="text-base font-black text-white">IMDb parents guide</h3></div>
                <span className="text-[11px] font-semibold text-slate-500">Community-voted guidance</span>
              </div>
              {details.parentsGuide.length ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {details.parentsGuide.map((guide) => (
                    <div key={guide.categoryId} className="flex items-center justify-between gap-3 border-b border-white/10 py-3">
                      <div><p className="text-sm font-bold text-slate-200">{guide.category}</p><p className="mt-0.5 text-[11px] text-slate-500">{guide.totalVotes.toLocaleString()} votes</p></div>
                      <span className={`rounded-full px-2 py-1 text-[11px] font-black ${severityTone(guide.severity)}`}>{guide.severityLabel || guide.severity}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="mt-3 text-sm text-slate-500">IMDb does not have community parental-guide ratings for this title yet.</p>}
            </section>
          </div>
        ) : null}
      </section>
    </div>
  );
};

const EmptyState: React.FC<{ error?: string | null }> = ({ error }) => (
  <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center">
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-200">
      <Search className="h-5 w-5" />
    </div>
    <h3 className="mt-4 text-lg font-bold text-white">
      {error ? "Buzz feed is unavailable" : "No matching titles yet"}
    </h3>
    <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">
      {error || "Try a broader genre mix or switch the year filter back to all years."}
    </p>
  </div>
);

export const BuzzWatch: React.FC = () => {
  const [preference, setPreference] = useState<BuzzWatchPreference | null>(null);
  const [data, setData] = useState<BuzzWatchResponse | null>(null);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [mode, setMode] = useState<BuzzWatchMode>("recent");
  const [view, setView] = useState<"buzz" | "cast">("buzz");
  const [year, setYear] = useState("all");
  const [mediaType, setMediaType] = useState<BuzzWatchMediaType>("all");
  const [activeGenre, setActiveGenre] = useState("all");
  const [movieHubAccess, setMovieHubAccess] = useState<BuzzWatchMovieHubAccess | null>(null);
  const [requestStateByItemId, setRequestStateByItemId] = useState<Record<string, "loading" | "PENDING" | "APPROVED" | "error">>({});
  const [loadingPreference, setLoadingPreference] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestFeedback, setRequestFeedback] = useState<string | null>(null);
  const [personQuery, setPersonQuery] = useState("");
  const [people, setPeople] = useState<BuzzWatchPerson[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<BuzzWatchPerson | null>(null);
  const [personCredits, setPersonCredits] = useState<BuzzWatchPersonCreditsResponse | null>(null);
  const [searchingPeople, setSearchingPeople] = useState(false);
  const [loadingCredits, setLoadingCredits] = useState(false);
  const [personError, setPersonError] = useState<string | null>(null);
  const [detailsItem, setDetailsItem] = useState<BuzzWatchItem | null>(null);
  const [titleDetails, setTitleDetails] = useState<BuzzWatchTitleDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  const genres = preference?.genres || data?.genres || [];

  const loadPreference = async () => {
    setLoadingPreference(true);
    setError(null);
    try {
      const response = await BuzzWatchService.getPreference();
      setPreference(response);
      setSelectedGenres(response.exists ? response.genreKeys : []);
      setActiveGenre("all");
    } catch (err: any) {
      setError(err?.message || "Failed to load preferences");
    } finally {
      setLoadingPreference(false);
    }
  };

  const fetchItems = async (
    nextMode: BuzzWatchMode = mode,
    nextYear: string = year,
    nextMediaType: BuzzWatchMediaType = mediaType,
    force = false,
  ) => {
    setLoadingItems(true);
    setError(null);
    try {
      const response = await BuzzWatchService.getItems(
        { mode: nextMode, year: nextYear, mediaType: nextMediaType },
        force,
      );
      setData(response);
    } catch (err: any) {
      setError(err?.message || "Failed to load buzz feed");
    } finally {
      setLoadingItems(false);
    }
  };

  useEffect(() => {
    loadPreference();
  }, []);

  useEffect(() => {
    if (!preference?.exists || editing) return;
    BuzzWatchService.getMovieHubAccess()
      .then(setMovieHubAccess)
      .catch(() => setMovieHubAccess(null));
  }, [preference?.exists, editing]);

  useEffect(() => {
    if (!preference?.exists || editing || view === "cast") return;
    fetchItems();
  }, [preference?.exists, mode, year, mediaType, editing, view]);

  useEffect(() => {
    if (view !== "cast" || !selectedPerson) return;
    setLoadingCredits(true);
    setPersonError(null);
    BuzzWatchService.getPersonCredits(selectedPerson.personId, mediaType)
      .then(setPersonCredits)
      .catch((err: any) => setPersonError(err?.message || "Failed to load filmography"))
      .finally(() => setLoadingCredits(false));
  }, [view, selectedPerson?.personId, mediaType]);

  const savePreference = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await BuzzWatchService.savePreference(selectedGenres);
      setPreference(response);
      setEditing(false);
      setMode("recent");
      setYear("all");
      setMediaType("all");
      setActiveGenre("all");
      await fetchItems("recent", "all", "all");
    } catch (err: any) {
      setError(err?.message || "Failed to save preferences");
    } finally {
      setSaving(false);
    }
  };

  if (loadingPreference) {
    return (
      <div className="portal-page flex min-h-screen items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (!preference?.exists || editing) {
    return (
      <Onboarding
        genres={genres}
        selectedGenres={selectedGenres}
        saving={saving}
        error={error}
        onChange={setSelectedGenres}
        onSave={savePreference}
      />
    );
  }

  const matchesActiveGenre = (item: BuzzWatchItem) =>
    activeGenre === "all" || item.genreKeys.includes(activeGenre);
  const matchesPreference = (item: BuzzWatchItem) =>
    Boolean(preference?.genreKeys.some((genreKey) => item.genreKeys.includes(genreKey)));
  const topItems = (data?.items || [])
    .filter(matchesPreference)
    .filter(matchesActiveGenre)
    .sort((first, second) =>
      (second.recommendationScore || second.matchScore || 0) -
        (first.recommendationScore || first.matchScore || 0) ||
      (second.buzzScore || 0) - (first.buzzScore || 0)
    );
  const visibleYears = staticYears();
  const heroItem = topItems[0];
  const activeItems = topItems;
  const canRequestMovieHub = Boolean(movieHubAccess?.hasAccess || movieHubAccess?.isAdmin);
  const genreOptions = genres.filter((genre) => preference?.genreKeys.includes(genre.key));

  const chooseMode = (nextMode: BuzzWatchMode) => {
    setView("buzz");
    setMode(nextMode);
    if (nextMode === "recent") {
      setYear("all");
      return;
    }
    if (year === "all") {
      setYear(visibleYears[0] || String(new Date().getFullYear()));
    }
  };

  const searchPeople = async (event: React.FormEvent) => {
    event.preventDefault();
    if (personQuery.trim().length < 2) return;
    setSearchingPeople(true);
    setPersonError(null);
    setSelectedPerson(null);
    setPersonCredits(null);
    try {
      const response = await BuzzWatchService.searchPeople(personQuery);
      setPeople(response.people);
      if (!response.people.length) setPersonError("No actors found. Try a fuller name.");
    } catch (err: any) {
      setPersonError(err?.message || "Actor search failed");
    } finally {
      setSearchingPeople(false);
    }
  };

  const clearPeopleSearch = () => {
    setPersonQuery("");
    setPeople([]);
    setSelectedPerson(null);
    setPersonCredits(null);
    setPersonError(null);
  };

  const requestTitle = async (item: BuzzWatchItem) => {
    if (!canRequestMovieHub || requestStateByItemId[item.itemId] === "loading") return;
    setRequestStateByItemId((current) => ({ ...current, [item.itemId]: "loading" }));
    try {
      const response = await BuzzWatchService.requestTitle(item.itemId);
      setRequestStateByItemId((current) => ({
        ...current,
        [item.itemId]: response.status === "APPROVED" ? "APPROVED" : "PENDING",
      }));
      setRequestFeedback(response.message || "Request submitted");
    } catch (err: any) {
      setRequestStateByItemId((current) => ({ ...current, [item.itemId]: "error" }));
      setRequestFeedback(err?.message || "Failed to request this title");
    }
  };

  const openDetails = async (item: BuzzWatchItem) => {
    setDetailsItem(item);
    setTitleDetails(null);
    setDetailsError(null);
    setLoadingDetails(true);
    try {
      setTitleDetails(await BuzzWatchService.getTitleDetails(item.itemId));
    } catch (err: any) {
      setDetailsError(err?.message || "Failed to load title details");
    } finally {
      setLoadingDetails(false);
    }
  };

  const closeDetails = () => {
    setDetailsItem(null);
    setTitleDetails(null);
    setDetailsError(null);
  };

  return (
    <div className="portal-page min-h-screen px-4 pb-12 pt-24 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 shadow-2xl shadow-black/25">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="p-5 sm:p-7 lg:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-bold text-cyan-200">
                    <Flame className="h-3.5 w-3.5" />
                    Streaming intelligence
                  </span>
                  <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-200">
                    {data?.ratingProvider || "Rating feed"}
                  </span>
                </div>
                <button
                  onClick={() => setEditing(true)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-200 transition hover:border-cyan-300/50 hover:text-white"
                  aria-label="Edit genres"
                  title="Edit genres"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
              <h1 className="mt-5 max-w-3xl text-3xl font-extrabold leading-tight text-white sm:text-4xl lg:text-5xl">
                BuzzWatch
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
                A 30-day radar across Netflix, Prime Video, JioHotstar, Apple TV and other major services—ranked by quality, momentum and your taste.
              </p>
              {data?.ratingProvider?.includes("TMDB") && (
                <p className="mt-2 text-[11px] font-medium text-slate-500">
                  This product uses the TMDB API but is not endorsed or certified by TMDB.
                  {data.insights?.availabilitySource ? ` Streaming availability is supplied by ${data.insights.availabilitySource}.` : ""}
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                {preference.genreKeys.slice(0, 8).map((key) => {
                  const genre = genres.find((item) => item.key === key);
                  return genre ? (
                    <span key={key} className="rounded-full bg-white/[0.07] px-2.5 py-1 text-xs font-bold text-slate-300">
                      {genre.name}
                    </span>
                  ) : null;
                })}
                {preference.genreKeys.length > 8 && (
                  <span className="rounded-full bg-white/[0.07] px-2.5 py-1 text-xs font-bold text-slate-300">
                    +{preference.genreKeys.length - 8}
                  </span>
                )}
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                  <p className="text-[11px] font-semibold uppercase text-slate-500">Matches</p>
                  <p className="mt-1 text-2xl font-black text-white">{data?.stats.totalMatches || 0}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                  <p className="text-[11px] font-semibold uppercase text-slate-500">Latest 30d</p>
                  <p className="mt-1 text-2xl font-black text-white">{data?.stats.recent || 0}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                  <p className="text-[11px] font-semibold uppercase text-slate-500">{mode === "recent" ? "Services" : "Rated"}</p>
                  <p className="mt-1 text-2xl font-black text-white">{mode === "recent" ? data?.stats.providers || 0 : data?.stats.rated ?? data?.stats.withRottenTomatoes ?? 0}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                  <p className="text-[11px] font-semibold uppercase text-slate-500">{mode === "recent" ? "Avg buzz" : "Updated"}</p>
                  <p className={mode === "recent" ? "mt-1 text-2xl font-black text-white" : "mt-1 text-sm font-bold text-white"}>
                    {mode === "recent" ? `${data?.stats.averageBuzz || 0}/100` : formatUpdated(data?.lastUpdatedAt)}
                  </p>
                </div>
              </div>
            </div>
            <div className="relative min-h-[280px] overflow-hidden border-t border-white/10 lg:border-l lg:border-t-0">
              <img
                src={heroItem?.backdropUrl || heroItem?.posterUrl || FALLBACK_POSTER}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-70"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-5">
                <p className="text-xs font-bold uppercase text-cyan-200">Top streaming pick</p>
                <p className="mt-1 line-clamp-2 text-2xl font-black text-white">
                  {heroItem?.title || "Awaiting buzz refresh"}
                </p>
                {heroItem ? (
                  <p className="mt-1 text-sm font-bold text-emerald-200">
                    Buzz {Math.round(heroItem.buzzScore || 0)}/100 · {heroItem.matchScore}% taste match
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-xl shadow-black/10">
          <div className="grid gap-3 xl:grid-cols-[minmax(230px,1fr)_minmax(230px,1fr)_minmax(230px,1fr)_180px_230px_auto] xl:items-end">
            <button
              onClick={() => chooseMode("recent")}
              className={`min-h-20 rounded-xl border p-4 text-left transition ${
                view === "buzz" && mode === "recent"
                  ? "border-cyan-300/60 bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-950/30"
                  : "border-white/10 bg-slate-950/60 text-slate-300 hover:border-white/25 hover:text-white"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-black">
                <Flame className="h-4 w-4" />
                Latest streaming
              </span>
              <span className={`mt-1 block text-xs font-semibold ${view === "buzz" && mode === "recent" ? "text-slate-800" : "text-slate-500"}`}>
                New movies, series and seasons from the last 30 days
              </span>
            </button>
            <button
              onClick={() => chooseMode("year")}
              className={`min-h-20 rounded-xl border p-4 text-left transition ${
                view === "buzz" && mode === "year"
                  ? "border-emerald-300/60 bg-emerald-300 text-slate-950 shadow-lg shadow-emerald-950/30"
                  : "border-white/10 bg-slate-950/60 text-slate-300 hover:border-white/25 hover:text-white"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-black">
                <CalendarRange className="h-4 w-4" />
                Explore by year
              </span>
              <span className={`mt-1 block text-xs font-semibold ${view === "buzz" && mode === "year" ? "text-slate-800" : "text-slate-500"}`}>
                Top ranked matches for a release year
              </span>
            </button>
            <button
              onClick={() => setView("cast")}
              className={`min-h-20 rounded-xl border p-4 text-left transition ${
                view === "cast"
                  ? "border-violet-300/60 bg-violet-300 text-slate-950 shadow-lg shadow-violet-950/30"
                  : "border-white/10 bg-slate-950/60 text-slate-300 hover:border-white/25 hover:text-white"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-black">
                <UserRound className="h-4 w-4" />
                Search by actor
              </span>
              <span className={`mt-1 block text-xs font-semibold ${view === "cast" ? "text-slate-800" : "text-slate-500"}`}>
                Browse a complete filmography newest first
              </span>
            </button>
            <label className="block">
              <span className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-slate-500">
                <CalendarRange className="h-3.5 w-3.5" />
                Release year
              </span>
              <select
                value={year}
                disabled={view === "cast" || mode !== "year"}
                onChange={(event) => {
                  setMode("year");
                  setYear(event.target.value);
                }}
                className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm font-semibold text-white outline-none transition focus:border-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="all" disabled>
                  Select year
                </option>
                {visibleYears.map((yearOption) => (
                  <option key={yearOption} value={yearOption}>
                    {yearOption}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-slate-500">
                <Tv className="h-3.5 w-3.5" />
                Type
              </p>
              <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-slate-950/70 p-1">
                {[
                  { value: "all", label: "All" },
                  { value: "movie", label: "Movies" },
                  { value: "series", label: "Series" },
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setMediaType(option.value as BuzzWatchMediaType)}
                    className={`min-h-9 rounded-lg px-2 text-xs font-black transition ${
                      mediaType === option.value
                        ? "bg-cyan-300 text-slate-950 shadow-sm shadow-cyan-950/30"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => {
                if (view === "cast" && selectedPerson) {
                  setLoadingCredits(true);
                  BuzzWatchService.getPersonCredits(selectedPerson.personId, mediaType)
                    .then(setPersonCredits)
                    .catch((err: any) => setPersonError(err?.message || "Failed to load filmography"))
                    .finally(() => setLoadingCredits(false));
                } else if (view === "buzz") {
                  fetchItems(mode, year, mediaType, true);
                }
              }}
              disabled={view === "cast" && !selectedPerson}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/10 px-3 text-xs font-bold text-slate-200 transition hover:border-cyan-300/50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
          {view === "cast" ? (
            <div className="space-y-4 border-t border-white/10 pt-4">
              <form onSubmit={searchPeople} className="flex flex-col gap-2 sm:flex-row">
                <label className="relative min-w-0 flex-1">
                  <span className="sr-only">Actor or actress name</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    value={personQuery}
                    onChange={(event) => setPersonQuery(event.target.value)}
                    placeholder="Search an actor or actress"
                    className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950/80 pl-10 pr-3 text-sm font-semibold text-white outline-none transition placeholder:text-slate-600 focus:border-violet-300/70"
                  />
                </label>
                <button
                  type="submit"
                  disabled={searchingPeople || personQuery.trim().length < 2}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-300 px-5 text-sm font-black text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {searchingPeople ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Search
                </button>
                {(personQuery || people.length > 0 || selectedPerson) && (
                  <button
                    type="button"
                    onClick={clearPeopleSearch}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 px-4 text-sm font-bold text-slate-300 transition hover:border-rose-300/50 hover:text-rose-200"
                    title="Clear actor search"
                  >
                    <X className="h-4 w-4" />
                    Clear
                  </button>
                )}
              </form>
              {people.length ? (
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {people.map((person) => (
                    <button
                      key={person.personId}
                      onClick={() => setSelectedPerson(person)}
                      className={`flex w-64 shrink-0 items-center gap-3 rounded-xl border p-2 text-left transition ${
                        selectedPerson?.personId === person.personId
                          ? "border-violet-300 bg-violet-300/10"
                          : "border-white/10 bg-slate-950/60 hover:border-white/25"
                      }`}
                    >
                      <div className="flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/[0.06] text-slate-500">
                        {person.profileUrl ? (
                          <img src={person.profileUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <UserRound className="h-5 w-5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-white">{person.name}</p>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-400">
                          {person.knownFor.join(" • ") || "Actor"}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
              {personError ? <p className="text-sm font-semibold text-rose-300">{personError}</p> : null}
            </div>
          ) : (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-slate-500">
              <Sparkles className="h-3.5 w-3.5" />
              Genre filter
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setActiveGenre("all")}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                  activeGenre === "all"
                    ? "border-cyan-300 bg-cyan-300 text-slate-950 shadow-sm shadow-cyan-950/30"
                    : "border-white/10 bg-slate-950/60 text-slate-300 hover:border-white/25"
                }`}
              >
                All genres
              </button>
              {genreOptions.map((genre) => (
                <button
                  key={genre.key}
                  onClick={() => setActiveGenre(genre.key)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                    activeGenre === genre.key
                      ? "border-cyan-300 bg-cyan-300 text-slate-950"
                      : "border-white/10 bg-slate-950/60 text-slate-300 hover:border-white/25"
                  }`}
                >
                  {genre.name}
                </button>
              ))}
            </div>
          </div>
          )}
        </section>

        {view === "cast" ? (
          <section className="space-y-4">
            {loadingCredits ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] py-12">
                <Loader />
              </div>
            ) : selectedPerson && personCredits ? (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-300">
                      Complete filmography
                    </p>
                    <h2 className="mt-1 text-xl font-black text-white">{personCredits.personName}</h2>
                    <p className="mt-1 text-sm text-slate-400">
                      {personCredits.total} {personCredits.total === 1 ? "credit" : "credits"}, newest first
                    </p>
                    {requestFeedback && (
                      <p className="mt-2 text-sm font-semibold text-cyan-200">{requestFeedback}</p>
                    )}
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-slate-300">
                    <Clapperboard className="h-3.5 w-3.5 text-violet-300" />
                    {personCredits.source}
                  </span>
                </div>
                {personCredits.items.length ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {personCredits.items.map((item) => (
                      <ItemCard
                        key={item.itemId}
                        item={item}
                        canRequest={canRequestMovieHub}
                        requestState={requestStateByItemId[item.itemId] || "idle"}
                        onRequest={requestTitle}
                        onDetails={openDetails}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState />
                )}
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-10 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-violet-300/10 text-violet-200">
                  <UserRound className="h-5 w-5" />
                </div>
                <h2 className="mt-4 text-lg font-black text-white">Find someone from the cast</h2>
                <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-400">
                  Search above, choose the right person, and their movie and series credits will appear here in reverse chronological order.
                </p>
              </div>
            )}
          </section>
        ) : loadingItems ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] py-12">
            <Loader />
          </div>
        ) : error ? (
          <EmptyState error={error} />
        ) : (
          <>
            <section className="space-y-4">
              <div>
                <p className={`text-[11px] font-bold uppercase tracking-[0.18em] ${mode === "recent" ? "text-cyan-300" : "text-emerald-300"}`}>
                  {mode === "recent" ? "Latest streaming" : "Year matches"}
                </p>
                <h2 className="mt-1 text-xl font-black text-white">
                  {mode === "recent"
                    ? "What is worth watching now"
                    : `Best matches from ${year}`}
                </h2>
                {requestFeedback && (
                  <p className="mt-2 text-sm font-semibold text-cyan-200">{requestFeedback}</p>
                )}
              </div>
              {mode === "recent" && data?.insights ? (
                <section className="grid gap-4 rounded-2xl border border-cyan-300/15 bg-gradient-to-br from-cyan-300/[0.08] via-slate-950/80 to-violet-300/[0.06] p-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-200">30-day streaming radar · {data.insights.watchRegion}</p>
                        <p className="mt-1 text-sm text-slate-300">
                          {data.insights.totalTitles} current titles across {data.insights.providerCounts.length} services · {data.insights.seriesCount} series · {data.insights.movieCount} movies
                        </p>
                      </div>
                      <span className="rounded-full bg-white/[0.07] px-3 py-1 text-xs font-bold text-slate-300">
                        {data.insights.highConfidenceTitles} high-confidence picks
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {data.insights.providerCounts.slice(0, 10).map((provider) => (
                        <span key={provider.name} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-950/60 px-2.5 py-1.5 text-[11px] font-bold text-slate-200">
                          {provider.logoUrl ? <img src={provider.logoUrl} alt="" className="h-4 w-4 rounded object-cover" /> : null}
                          {provider.name}
                          <span className="text-slate-500">{provider.count}</span>
                        </span>
                      ))}
                    </div>
                    {data.insights.providerCounts.some((provider) => provider.name === "JioHotstar") ? (
                      <p className="mt-3 text-[11px] text-slate-500">HBO releases in India are represented through JioHotstar availability.</p>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-950/55 p-4">
                    <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-violet-200">
                      <Clapperboard className="h-4 w-4" />
                      How buzz is calculated
                    </p>
                    <p className="mt-2 text-xs leading-5 text-slate-400">{data.insights.methodology}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {data.insights.topGenres.map((genre) => (
                        <span key={genre.name} className="rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-bold text-slate-300">{genre.name} · {genre.count}</span>
                      ))}
                    </div>
                    <p className="mt-3 text-[10px] text-slate-600">Streaming availability: {data.insights.availabilitySource}</p>
                  </div>
                </section>
              ) : null}
              {activeItems.length ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {activeItems.map((item) => (
                    <ItemCard
                      key={item.itemId}
                      item={item}
                      canRequest={canRequestMovieHub}
                      requestState={requestStateByItemId[item.itemId] || "idle"}
                      onRequest={requestTitle}
                      onDetails={openDetails}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState />
              )}
            </section>
          </>
        )}
      </div>
      {detailsItem ? (
        <TitleDetailsModal
          item={detailsItem}
          details={titleDetails}
          loading={loadingDetails}
          error={detailsError}
          onClose={closeDetails}
        />
      ) : null}
    </div>
  );
};

export default BuzzWatch;

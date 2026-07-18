import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BellRing,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ExternalLink,
  Loader2,
  Plane,
  Plus,
  RefreshCw,
  Route,
  Trash2,
  Users,
} from "lucide-react";
import { FlightService, type FlightWatchPayload } from "../apis/flights/flights";
import { useAuth } from "../context/AuthContext";
import { useApiFetcher } from "../hooks/useApiFetcher";
import { useNotification } from "../context/NotificationContext";
import { Loader } from "./Loader";
import { useNavigate } from "react-router-dom";

type FlightWatch = {
  watchId: string;
  origin: string;
  originLabel?: string;
  destination: string;
  destinationLabel?: string;
  departureDate: string;
  returnDate?: string;
  tripType?: string;
  adults: number;
  children: number;
  infants: number;
  cabin: string;
  currency: string;
  thresholdPrice: number;
  maxStops?: number | null;
  note?: string;
  lastPrice?: number;
  lastCurrency?: string;
  lastAirlines?: string[];
  lastStops?: number;
  lastProvider?: string;
  lastOffers?: FlightOffer[];
  lastCheckedAt?: string;
  lastError?: string;
  sourceUrl?: string;
  active: boolean;
};

type FlightOffer = {
  price: number;
  currency: string;
  airlines?: string[];
  stops?: number | null;
  departureAt?: string;
  arrivalAt?: string;
  sourceUrl?: string;
  provider?: string;
  source?: string;
};

type Place = {
  code: string;
  label: string;
  subtitle: string;
  city: string;
  name: string;
  country: string;
};

const emptyForm: FlightWatchPayload = {
  origin: "",
  originLabel: "",
  destination: "",
  destinationLabel: "",
  departureDate: "",
  returnDate: "",
  adults: 1,
  children: 0,
  infants: 0,
  cabin: "ECONOMY",
  currency: "INR",
  thresholdPrice: "",
  maxStops: "",
  note: "",
};

const cabins = [
  { value: "ECONOMY", label: "Economy" },
  { value: "PREMIUM_ECONOMY", label: "Premium economy" },
  { value: "BUSINESS", label: "Business" },
  { value: "FIRST", label: "First" },
];

const today = new Date().toISOString().slice(0, 10);

const formatMoney = (amount?: number, currency = "INR") => {
  if (amount === undefined || amount === null) return "Not checked";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatDateTime = (value?: string) => {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

const routeLabel = (watch: FlightWatch) =>
  `${watch.originLabel || watch.origin} to ${watch.destinationLabel || watch.destination}`;

const formatStops = (stops?: number | null) => {
  if (stops === undefined || stops === null) return "Any stops";
  if (stops === 0) return "Nonstop";
  return `${stops} stop${stops === 1 ? "" : "s"}`;
};

const providerLabel = (provider?: string) =>
  (provider || "provider").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const priceDelta = (watch: FlightWatch) => {
  if (watch.lastPrice === undefined || watch.lastPrice === null) return null;
  return Number(watch.lastPrice) - Number(watch.thresholdPrice);
};

const FlightTracker = () => {
  const navigate = useNavigate();
  const { addNotification } = useNotification();
  const { isAuthenticated, isAuthLoading } = useAuth();
  const watchesFetcher = useApiFetcher();
  const createFetcher = useApiFetcher();
  const statusFetcher = useApiFetcher();
  const deleteFetcher = useApiFetcher();
  const checkFetcher = useApiFetcher();

  const [form, setForm] = useState<FlightWatchPayload>(emptyForm);
  const [tripType, setTripType] = useState<"one-way" | "return">("one-way");
  const [originQuery, setOriginQuery] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [originResults, setOriginResults] = useState<Place[]>([]);
  const [destinationResults, setDestinationResults] = useState<Place[]>([]);
  const [busyWatchId, setBusyWatchId] = useState<string | null>(null);

  const watches: FlightWatch[] = useMemo(
    () => (Array.isArray(watchesFetcher.data?.body) ? watchesFetcher.data.body : []),
    [watchesFetcher.data]
  );
  const configured = statusFetcher.data?.body?.configured === true;
  const checkedCount = watches.filter((watch) => watch.lastCheckedAt).length;
  const underTargetCount = watches.filter((watch) => {
    const delta = priceDelta(watch);
    return delta !== null && delta <= 0;
  }).length;
  const flightDetailsReady = Boolean(
    form.origin &&
      form.destination &&
      form.departureDate &&
      form.thresholdPrice &&
      (tripType === "one-way" || form.returnDate)
  );
  const formIssue = !form.origin
    ? "Select a departure airport from the search results."
    : !form.destination
      ? "Select an arrival airport from the search results."
      : !form.departureDate
        ? "Choose a departure date."
        : tripType === "return" && !form.returnDate
          ? "Choose a return date."
          : !form.thresholdPrice
            ? "Enter the INR price that should trigger an alert."
            : "";

  const loadWatches = () => {
    if (!isAuthenticated) return;
    const request = FlightService.getWatches();
    watchesFetcher.fetchData(request.url, request.options);
  };

  useEffect(() => {
    const statusRequest = FlightService.providerStatus();
    statusFetcher.fetchData(statusRequest.url, statusRequest.options);
  }, []);

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated) return;
    loadWatches();
  }, [isAuthenticated, isAuthLoading]);

  useEffect(() => {
    if (!createFetcher.data) return;
    if (createFetcher.data.status === 200) {
      addNotification("Flight watch added.", "success");
      setForm({ ...emptyForm });
      setTripType("one-way");
      setOriginQuery("");
      setDestinationQuery("");
      loadWatches();
    } else {
      addNotification(createFetcher.data.body?.error || "Could not add flight watch", "error");
    }
  }, [createFetcher.data]);

  useEffect(() => {
    if (!deleteFetcher.data) return;
    if (deleteFetcher.data.status === 200) {
      addNotification("Flight watch removed.", "success");
      loadWatches();
    } else {
      addNotification(deleteFetcher.data.body?.error || "Could not remove flight watch", "error");
    }
  }, [deleteFetcher.data]);

  useEffect(() => {
    if (!checkFetcher.data) return;
    setBusyWatchId(null);
    if (checkFetcher.data.status === 200) {
      const alerted = checkFetcher.data.body?.response?.alerted;
      addNotification(alerted ? "Checked and alert email sent." : "Latest fare checked.", "success");
      loadWatches();
    } else {
      addNotification(checkFetcher.data.body?.error || "Flight check failed", "error");
      loadWatches();
    }
  }, [checkFetcher.data]);

  useEffect(() => {
    const query = originQuery.trim();
    if (query.length < 2 || form.originLabel === originQuery) {
      setOriginResults([]);
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      const request = FlightService.searchPlaces(query);
      try {
        const response = await fetch(request.url, { ...request.options, signal: controller.signal });
        const body = await response.json();
        setOriginResults(Array.isArray(body.results) ? body.results : []);
      } catch {
        if (!controller.signal.aborted) setOriginResults([]);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [originQuery, form.originLabel]);

  useEffect(() => {
    const query = destinationQuery.trim();
    if (query.length < 2 || form.destinationLabel === destinationQuery) {
      setDestinationResults([]);
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      const request = FlightService.searchPlaces(query);
      try {
        const response = await fetch(request.url, { ...request.options, signal: controller.signal });
        const body = await response.json();
        setDestinationResults(Array.isArray(body.results) ? body.results : []);
      } catch {
        if (!controller.signal.aborted) setDestinationResults([]);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [destinationQuery, form.destinationLabel]);

  const updateField = (field: keyof FlightWatchPayload, value: string | number) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const selectOrigin = (place: Place) => {
    setOriginQuery(place.label);
    setOriginResults([]);
    setForm((current) => ({ ...current, origin: place.code, originLabel: place.label }));
  };

  const selectDestination = (place: Place) => {
    setDestinationQuery(place.label);
    setDestinationResults([]);
    setForm((current) => ({ ...current, destination: place.code, destinationLabel: place.label }));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isAuthenticated) {
      navigate("/login", { state: { from: "/flighttracker" } });
      return;
    }
    const payload = {
      ...form,
      returnDate: tripType === "return" ? form.returnDate : "",
    };
    const request = FlightService.createWatch(payload);
    createFetcher.fetchData(request.url, request.options);
  };

  const removeWatch = (watchId: string) => {
    const request = FlightService.deleteWatch(watchId);
    deleteFetcher.fetchData(request.url, request.options);
  };

  const checkWatch = (watchId: string) => {
    setBusyWatchId(watchId);
    const request = FlightService.checkWatch(watchId);
    checkFetcher.fetchData(request.url, request.options);
  };

  if (isAuthLoading) return <Loader />;

  return (
    <div className="portal-page flight-tracker-workspace min-h-screen w-full transition-colors duration-300">
      <div className="toolhub-desktop-container mx-auto max-w-7xl px-4 pb-12 pt-24 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <p className="tool-workspace-kicker">Fare intelligence</p>
            <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Flight Tracker
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Track one-way or return fares, compare live provider results, and get emailed when a fare is at or below your target.
            </p>
          </div>
          {!isAuthenticated ? (
            <button onClick={() => navigate("/login", { state: { from: "/flighttracker" } })} className="portal-primary-button">
              Log in to track
            </button>
          ) : (
            <button onClick={loadWatches} className="portal-secondary-button">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          )}
        </header>

        <div className="tool-metric-grid mb-6">
          <div className="tool-metric-card">
            <Route />
            <span><strong>{watches.length}</strong>Tracked routes</span>
          </div>
          <div className="tool-metric-card">
            <CircleDollarSign />
            <span><strong>{underTargetCount}</strong>At target</span>
          </div>
          <div className="tool-metric-card">
            <CheckCircle2 />
            <span><strong>{checkedCount}</strong>Checked once</span>
          </div>
          <div className="tool-metric-card">
            <BellRing />
            <span><strong>{configured ? "Live" : "Setup"}</strong>Email alerts</span>
          </div>
        </div>

        <div className="mb-6 flex items-start gap-3 rounded-xl border border-sky-400/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Live flight sites can rate-limit automated checks. Failed checks are saved in history, and the next scheduled run keeps trying.</span>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(360px,0.82fr)_minmax(0,1.18fr)]">
          <form onSubmit={submit} className="tool-workspace-card p-5 sm:p-7">
            <div className="mb-5 flex items-center gap-3">
              <span className="tool-workspace-icon">
                <Plane className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-bold text-white">Add watch</h2>
                <p className="text-xs text-slate-500">Choose airports, set your target, then let scheduled checks do the quiet work.</p>
              </div>
            </div>

            <div className="price-mode-switch mb-5">
              <button type="button" onClick={() => setTripType("one-way")} className={tripType === "one-way" ? "price-mode-active" : ""}>
                One-way
              </button>
              <button type="button" onClick={() => setTripType("return")} className={tripType === "return" ? "price-mode-active" : ""}>
                Return
              </button>
            </div>

            <div className="mb-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl border border-white/10 bg-slate-950/35 p-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-slate-600">From</p>
                <p className="truncate text-sm font-bold text-white">{form.originLabel || "Select origin"}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-500" />
              <div className="min-w-0 text-right">
                <p className="text-[10px] uppercase tracking-wide text-slate-600">To</p>
                <p className="truncate text-sm font-bold text-white">{form.destinationLabel || "Select destination"}</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="relative text-xs font-semibold text-slate-300">
                From
                <input
                  value={originQuery}
                  onChange={(event) => {
                    setOriginQuery(event.target.value);
                    setForm((current) => ({ ...current, origin: "", originLabel: "" }));
                  }}
                  placeholder="Delhi, San Francisco, JFK..."
                  className="mt-2 w-full rounded-lg px-3 py-2 text-sm"
                  autoComplete="off"
                  aria-invalid={Boolean(originQuery && !form.origin)}
                  required
                />
                {originResults.length > 0 && (
                  <div className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-white/10 bg-slate-950 shadow-2xl">
                    {originResults.map((place) => (
                      <button key={place.code} type="button" onClick={() => selectOrigin(place)} className="block w-full px-3 py-2 text-left hover:bg-white/[0.06]">
                        <span className="block text-sm font-bold text-white">{place.label}</span>
                        <span className="block text-xs text-slate-500">{place.subtitle}</span>
                      </button>
                    ))}
                  </div>
                )}
                {originQuery && !form.origin && originResults.length === 0 && (
                  <span className="mt-1 block text-[11px] text-amber-300">Keep typing, then select an airport result.</span>
                )}
              </label>

              <label className="relative text-xs font-semibold text-slate-300">
                To
                <input
                  value={destinationQuery}
                  onChange={(event) => {
                    setDestinationQuery(event.target.value);
                    setForm((current) => ({ ...current, destination: "", destinationLabel: "" }));
                  }}
                  placeholder="London, Tokyo, SFO..."
                  className="mt-2 w-full rounded-lg px-3 py-2 text-sm"
                  autoComplete="off"
                  aria-invalid={Boolean(destinationQuery && !form.destination)}
                  required
                />
                {destinationResults.length > 0 && (
                  <div className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-white/10 bg-slate-950 shadow-2xl">
                    {destinationResults.map((place) => (
                      <button key={place.code} type="button" onClick={() => selectDestination(place)} className="block w-full px-3 py-2 text-left hover:bg-white/[0.06]">
                        <span className="block text-sm font-bold text-white">{place.label}</span>
                        <span className="block text-xs text-slate-500">{place.subtitle}</span>
                      </button>
                    ))}
                  </div>
                )}
                {destinationQuery && !form.destination && destinationResults.length === 0 && (
                  <span className="mt-1 block text-[11px] text-amber-300">Keep typing, then select an airport result.</span>
                )}
              </label>

              <label className="text-xs font-semibold text-slate-300">
                Departure
                <input type="date" min={today} value={form.departureDate} onChange={(event) => updateField("departureDate", event.target.value)} className="mt-2 w-full rounded-lg px-3 py-2 text-sm" required />
              </label>
              <label className="text-xs font-semibold text-slate-300">
                Return
                <input type="date" disabled={tripType === "one-way"} min={form.departureDate || today} value={tripType === "return" ? form.returnDate : ""} onChange={(event) => updateField("returnDate", event.target.value)} className="mt-2 w-full rounded-lg px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-45" required={tripType === "return"} />
              </label>
              <label className="text-xs font-semibold text-slate-300">
                Cabin
                <select value={form.cabin} onChange={(event) => updateField("cabin", event.target.value)} className="tool-select mt-2">
                  {cabins.map((cabin) => <option key={cabin.value} value={cabin.value}>{cabin.label}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-300">
                Currency
                <select value={form.currency} onChange={(event) => updateField("currency", event.target.value)} className="tool-select mt-2">
                  <option value="INR">INR - Indian rupee</option>
                  <option value="USD">USD - US dollar</option>
                  <option value="EUR">EUR - Euro</option>
                  <option value="GBP">GBP - British pound</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-300">
                Alert below
                <input type="number" min="1" step="1" value={form.thresholdPrice} onChange={(event) => updateField("thresholdPrice", event.target.value)} placeholder="8,000" className="mt-2 w-full rounded-lg px-3 py-2 text-sm" required />
              </label>
              <label className="text-xs font-semibold text-slate-300">
                Max stops
                <select value={form.maxStops} onChange={(event) => updateField("maxStops", event.target.value)} className="tool-select mt-2">
                  <option value="">Any</option>
                  <option value="0">Nonstop</option>
                  <option value="1">1 stop</option>
                  <option value="2">2 stops</option>
                  <option value="3">3 stops</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-300">
                Adults
                <input type="number" min="1" max="9" value={form.adults} onChange={(event) => updateField("adults", Number(event.target.value))} className="mt-2 w-full rounded-lg px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-slate-300">
                Children
                <input type="number" min="0" max="9" value={form.children} onChange={(event) => updateField("children", Number(event.target.value))} className="mt-2 w-full rounded-lg px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-slate-300">
                Infants
                <input type="number" min="0" max={form.adults} value={form.infants} onChange={(event) => updateField("infants", Number(event.target.value))} className="mt-2 w-full rounded-lg px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-semibold text-slate-300 sm:col-span-2">
                Note
                <input value={form.note} onChange={(event) => updateField("note", event.target.value)} placeholder="School break, visa window, preferred airline..." className="mt-2 w-full rounded-lg px-3 py-2 text-sm" />
              </label>
            </div>

            {isAuthenticated && formIssue && (
              <p className="mt-4 text-xs text-amber-300">{formIssue}</p>
            )}
            <button disabled={createFetcher.loading || (isAuthenticated && !flightDetailsReady)} className="portal-primary-button mt-3 w-full">
              {createFetcher.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {!isAuthenticated ? "Log in to track" : flightDetailsReady ? "Track and check price" : "Complete flight details"}
            </button>
          </form>

          <section className="tool-workspace-card p-5 sm:p-7">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white">Tracked flights</h2>
                <p className="text-xs text-slate-500">Manual checks are available anytime; scheduled polling runs in the backend.</p>
              </div>
            </div>

            {!isAuthenticated ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-400">
                Log in to save routes and receive alerts.
              </div>
            ) : watchesFetcher.loading ? (
              <Loader />
            ) : watches.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-400">
                No flight watches yet.
              </div>
            ) : (
              <div className="space-y-3">
                {watches.map((watch) => (
                  <article key={watch.watchId} className="rounded-xl border border-white/10 bg-slate-950/35 p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-bold text-white">{routeLabel(watch)}</h3>
                          <span className="rounded-full border border-sky-400/25 bg-sky-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-sky-200">
                            {watch.returnDate ? "RETURN" : "ONE-WAY"}
                          </span>
                          {priceDelta(watch) !== null && (
                            <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${priceDelta(watch)! <= 0 ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : "border-amber-400/25 bg-amber-500/10 text-amber-200"}`}>
                              {priceDelta(watch)! <= 0 ? "At target" : `${formatMoney(priceDelta(watch)!, watch.lastCurrency || watch.currency)} over`}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {watch.departureDate}{watch.returnDate ? ` to ${watch.returnDate}` : ""} - {watch.adults} adult{watch.adults === 1 ? "" : "s"} - {formatStops(watch.maxStops)} - target {formatMoney(watch.thresholdPrice, watch.currency)}
                        </p>
                        {watch.lastError && <p className="mt-2 text-xs text-rose-300">{watch.lastError}</p>}
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-right sm:grid-cols-4 lg:min-w-[430px]">
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-slate-600">Latest</p>
                          <p className="text-sm font-bold text-emerald-300">{formatMoney(watch.lastPrice, watch.lastCurrency || watch.currency)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-slate-600">Checked</p>
                          <p className="text-xs font-semibold text-slate-300">{formatDateTime(watch.lastCheckedAt)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-slate-600">Provider</p>
                          <p className="truncate text-xs font-semibold text-slate-300">{providerLabel(watch.lastProvider)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-slate-600">Passengers</p>
                          <p className="text-xs font-semibold text-slate-300">{watch.adults + watch.children + watch.infants} total</p>
                        </div>
                      </div>
                    </div>
                    {Array.isArray(watch.lastOffers) && watch.lastOffers.length > 0 && (
                      <div className="mt-4 grid gap-2 md:grid-cols-3">
                        {watch.lastOffers.slice(0, 3).map((offer, index) => (
                          <a
                            key={`${watch.watchId}-${offer.provider}-${offer.price}-${index}`}
                            href={offer.sourceUrl || watch.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-white/10 bg-white/[0.03] p-3 transition hover:border-sky-300/40 hover:bg-white/[0.06]"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-bold text-white">{formatMoney(offer.price, offer.currency || watch.currency)}</p>
                              <ExternalLink className="h-3.5 w-3.5 text-slate-500" />
                            </div>
                            <p className="mt-1 truncate text-[11px] font-semibold text-slate-400">
                              {providerLabel(offer.provider)} - {formatStops(offer.stops)}
                            </p>
                            <p className="mt-1 truncate text-[11px] text-slate-500">{offer.airlines?.join(", ") || "Airline pending"}</p>
                          </a>
                        ))}
                      </div>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button onClick={() => checkWatch(watch.watchId)} disabled={busyWatchId === watch.watchId} className="portal-secondary-button min-h-0 py-2">
                        {busyWatchId === watch.watchId ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Check now
                      </button>
                      <button onClick={() => navigate(`/flighttracker/history/${watch.watchId}`)} className="portal-secondary-button min-h-0 py-2">
                        <BarChart3 className="h-4 w-4" />
                        Graph
                      </button>
                      {watch.sourceUrl && (
                        <a href={watch.sourceUrl} target="_blank" rel="noopener noreferrer" className="portal-secondary-button min-h-0 py-2">
                          <ExternalLink className="h-4 w-4" />
                          Open
                        </a>
                      )}
                      <button onClick={() => removeWatch(watch.watchId)} className="portal-secondary-button min-h-0 py-2 text-rose-200">
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default FlightTracker;

import React, { useEffect, useMemo } from "react";
import { ArrowLeft, ExternalLink, Plane } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { FlightService } from "../apis/flights/flights";
import { useApiFetcher } from "../hooks/useApiFetcher";
import { Loader } from "./Loader";
import FlightPriceChart from "./FlightPriceChart";

type FlightWatch = {
  watchId: string;
  origin: string;
  originLabel?: string;
  destination: string;
  destinationLabel?: string;
  departureDate: string;
  returnDate?: string;
  tripType?: string;
  cabin: string;
  currency: string;
  thresholdPrice: number;
  sourceUrl?: string;
};

const formatMoney = (amount?: number, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));

const FlightHistoryPage = () => {
  const { watchId = "" } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, fetchData } = useApiFetcher();

  useEffect(() => {
    if (!watchId) return;
    const request = FlightService.getWatch(watchId);
    fetchData(request.url, request.options);
  }, [watchId, fetchData]);

  const watch = useMemo<FlightWatch | null>(() => {
    if (!data?.body || data.status !== 200) return null;
    return data.body as FlightWatch;
  }, [data]);

  if (loading) return <div className="portal-page flex min-h-screen items-center justify-center"><Loader /></div>;

  return (
    <div className="portal-page flight-tracker-workspace min-h-screen w-full transition-colors duration-300">
      <div className="toolhub-desktop-container mx-auto max-w-6xl px-4 pb-12 pt-24 sm:px-6 lg:px-8">
        <button onClick={() => navigate("/flighttracker")} className="portal-secondary-button mb-6">
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        {error || !watch ? (
          <div className="tool-workspace-card p-8 text-sm text-rose-300">Flight watch not found.</div>
        ) : (
          <>
            <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="tool-workspace-kicker">Fare history</p>
                <h1 className="text-3xl font-extrabold tracking-tight text-white">
                  {watch.originLabel || watch.origin} to {watch.destinationLabel || watch.destination}
                </h1>
                <p className="mt-2 text-sm text-slate-400">
                  {watch.departureDate}
                  {watch.returnDate ? ` to ${watch.returnDate}` : " one-way"} - {watch.cabin.replace("_", " ").toLowerCase()} - alert below {formatMoney(watch.thresholdPrice, watch.currency)}
                </p>
              </div>
              {watch.sourceUrl && (
                <a href={watch.sourceUrl} target="_blank" rel="noopener noreferrer" className="portal-secondary-button">
                  <ExternalLink className="h-4 w-4" />
                  Open search
                </a>
              )}
            </header>

            <section className="tool-workspace-card p-5 sm:p-7">
              <div className="mb-5 flex items-center gap-3">
                <span className="tool-workspace-icon">
                  <Plane className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-lg font-bold text-white">Price trend</h2>
                  <p className="text-xs text-slate-500">Successful checks are plotted here. Blocked or failed checks are kept in raw history but skipped from the graph.</p>
                </div>
              </div>
              <FlightPriceChart watchId={watch.watchId} currency={watch.currency} />
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default FlightHistoryPage;

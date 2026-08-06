import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FlightService } from "../apis/flights/flights";
import { useApiFetcher } from "../hooks/useApiFetcher";
import { Loader } from "./Loader";

type FlightHistoryEntry = {
  price?: number;
  currency?: string;
  status: "ok" | "error";
  createdAt: string;
};

type ChartPoint = {
  date: string;
  price: number;
  rawDate: Date;
  currency: string;
};

const FILTERS = {
  "1D": 1,
  "1M": 30,
  "3M": 90,
};

const formatDate = (date: Date) => dayjs(date).format("DD MMM, HH:mm");

const FlightPriceChart = ({ watchId, currency = "INR" }: { watchId: string; currency?: string }) => {
  const { data, error, loading, fetchData } = useApiFetcher();
  const [selectedRange, setSelectedRange] = useState<keyof typeof FILTERS>("1M");

  useEffect(() => {
    if (!watchId) return;
    const request = FlightService.getHistory(watchId);
    fetchData(request.url, request.options);
  }, [watchId, fetchData]);

  const allChartData: ChartPoint[] = useMemo(() => {
    const entries = Array.isArray(data?.body) ? (data.body as FlightHistoryEntry[]) : [];
    return entries
      .filter((entry) => entry.status === "ok" && entry.price !== undefined)
      .map((entry) => {
        const rawDate = new Date(entry.createdAt);
        return {
          rawDate,
          date: formatDate(rawDate),
          price: Number(entry.price),
          currency: entry.currency || currency,
        };
      })
      .filter((entry) => !isNaN(entry.price) && !isNaN(entry.rawDate.getTime()))
      .sort((a, b) => a.rawDate.getTime() - b.rawDate.getTime());
  }, [data, currency]);

  const filteredChartData = useMemo(() => {
    const daysLimit = FILTERS[selectedRange];
    const now = new Date();
    return allChartData.filter(
      (entry) => (now.getTime() - entry.rawDate.getTime()) / (1000 * 60 * 60 * 24) <= daysLimit
    );
  }, [allChartData, selectedRange]);

  if (loading) return <Loader />;
  if (error) return <p className="text-sm text-rose-300">Failed to load flight history.</p>;
  if (allChartData.length === 0) return <p className="text-sm text-slate-500">No successful price history yet.</p>;

  return (
    <div className="flex h-80 w-full flex-col">
      <div className="mb-4 flex justify-end gap-2">
        {Object.keys(FILTERS).map((key) => (
          <button
            key={key}
            onClick={() => setSelectedRange(key as keyof typeof FILTERS)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              selectedRange === key
                ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-md"
                : "bg-slate-900 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {key}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={filteredChartData} margin={{ top: 20, right: 30, bottom: 40, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} angle={-45} textAnchor="end" height={60} />
            <YAxis
              tick={{ fill: "#94a3b8" }}
              tickFormatter={(value) =>
                new Intl.NumberFormat("en-IN", {
                  style: "currency",
                  currency,
                  maximumFractionDigits: 0,
                }).format(Number(value))
              }
            />
            <Tooltip
              formatter={(value) =>
                new Intl.NumberFormat("en-IN", {
                  style: "currency",
                  currency,
                  maximumFractionDigits: 0,
                }).format(Number(value))
              }
              contentStyle={{
                backgroundColor: "rgba(15, 23, 42, 0.96)",
                border: "1px solid rgba(148, 163, 184, 0.25)",
                borderRadius: "0.75rem",
                color: "#f8fafc",
              }}
              labelStyle={{ color: "#cbd5e1", fontWeight: 600 }}
            />
            <Line type="monotone" dataKey="price" stroke="#38bdf8" strokeWidth={2} dot={{ fill: "#38bdf8", r: 4 }} activeDot={{ r: 6, fill: "#818cf8" }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default FlightPriceChart;

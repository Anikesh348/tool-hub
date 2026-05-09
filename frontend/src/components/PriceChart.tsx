import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useApiFetcher } from "../hooks/useApiFetcher";
import { useAuth } from "../context/AuthContext";
import { Loader } from "./Loader";
import dayjs from "dayjs";
import { ProductService } from "../apis/product/product";

interface PriceChartProps {
  productId: string;
}

interface PriceEntry {
  productPrice: string;
  captureTime?: string;
  createdAt?: string;
}

interface PricePoint {
  date: string;
  price: number;
  rawDate: Date;
}

const formatDate = (date: Date) => dayjs(date).format("DD MMM, HH:mm");

const FILTERS = {
  "1D": 1,
  "1M": 30,
  "3M": 90,
};

const PriceChart: React.FC<PriceChartProps> = ({ productId }) => {
  const { authToken } = useAuth();
  const { data, error, loading, fetchData } = useApiFetcher();
  const [selectedRange, setSelectedRange] =
    useState<keyof typeof FILTERS>("1M");

  useEffect(() => {
    if (authToken && productId) {
      const { url, options } = ProductService.getPriceHistory(productId);
      fetchData(url, options);
    }
  }, [authToken, productId, fetchData]);

  const allChartData: PricePoint[] = useMemo(() => {
    if (!data || data.status !== 200 || !data.body) return [];

    const entries = Array.isArray(data.body)
      ? (data.body as PriceEntry[])
      : Array.isArray((data.body as { response?: PriceEntry[] }).response)
      ? ((data.body as { response?: PriceEntry[] }).response as PriceEntry[])
      : [];

    return entries
      .map((entry) => {
        const priceText = String(entry.productPrice ?? "");
        const price = parseFloat(priceText.replace(/[^0-9.]/g, ""));
        const timestamp = entry.captureTime ?? entry.createdAt ?? "";
        const rawDate = new Date(timestamp);

        return {
          rawDate,
          date: formatDate(rawDate),
          price,
        };
      })
      .filter(
        (entry) => !isNaN(entry.price) && !isNaN(entry.rawDate.getTime())
      );
  }, [data]);

  const filteredChartData = useMemo(() => {
    const daysLimit = FILTERS[selectedRange];
    const now = new Date();
    return allChartData.filter(
      (entry) =>
        (now.getTime() - entry.rawDate.getTime()) / (1000 * 60 * 60 * 24) <=
        daysLimit
    );
  }, [allChartData, selectedRange]);

  if (loading) return <Loader />;
  if (error)
    return <p className="text-red-500 text-sm">Failed to load chart.</p>;
  if (allChartData.length === 0)
    return <p className="text-sm text-gray-500">No price history found.</p>;

  return (
    <div className="w-full h-72 flex flex-col">
      <div className="flex justify-end mb-4 gap-2">
        {Object.keys(FILTERS).map((key) => (
          <button
            key={key}
            onClick={() => setSelectedRange(key as keyof typeof FILTERS)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              selectedRange === key
                ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-md"
                : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {key}
          </button>
        ))}
      </div>

      <div className="flex-1 w-full" style={{ minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            margin={{ top: 20, right: 30, bottom: 40, left: 20 }}
            data={filteredChartData}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis
              tickFormatter={(value) =>
                `₹${value.toLocaleString("en-IN", {
                  maximumFractionDigits: 0,
                })}`
              }
            />
            <Tooltip
              formatter={(value) => `₹${value}`}
              contentStyle={{
                backgroundColor: "rgba(255, 255, 255, 0.95)",
                border: "1px solid #e5e7eb",
                borderRadius: "0.5rem",
                boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
              }}
              labelStyle={{
                color: "#1f2937",
                fontWeight: "600",
              }}
              wrapperStyle={{
                outline: "none",
              }}
            />
            <Line
              type="monotone"
              dataKey="price"
              stroke="#8884d8"
              dot={{ fill: "#8884d8", r: 4 }}
              activeDot={{ r: 6, fill: "#6366f1" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default PriceChart;

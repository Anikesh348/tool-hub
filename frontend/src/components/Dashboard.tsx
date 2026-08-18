import React, { useEffect, useMemo, useRef, useState } from "react";
import { useApiFetcher } from "../hooks/useApiFetcher";
import { useAuth } from "../context/AuthContext";
import { requestJson } from "../utils/apiRequest";
import PriceChart from "./PriceChart";
import { Loader } from "./Loader";
import { useLocation, useNavigate } from "react-router-dom";
import { ProductService } from "../apis/product/product";
import {
  ArrowLeft,
  Box,
  ChevronDown,
  Clock3,
  MoreVertical,
  Percent,
  Plus,
  Search,
  Target,
  TrendingDown,
  TrendingUp,
  Trash2,
  Wallet,
} from "lucide-react";
import { useNotification } from "../context/NotificationContext";
import { locationPath } from "../utils/authRedirect";
import { platformIdFromProductId, platformMetaForId } from "../utils/storePlatforms";

interface Product {
  productImageUrl: string;
  productTitle: string;
  targetPrice: string;
  productUrl: string;
  productId: string;
}

interface ProductMetrics {
  currentPrice: number;
  previousPrice: number | null;
  peakPrice: number;
  lastCheckedIso: string | null;
  sparkline: number[];
}

type SortOption = "lastChecked" | "priceAsc" | "priceDesc";

const formatINR = (price: number): string =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(price);

const relativeTime = (value: string | null): string => {
  if (!value) return "Not checked yet";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Not checked yet";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(value).toLocaleDateString();
};

function Sparkline({ points, trendingUp }: { points: number[]; trendingUp: boolean }) {
  if (points.length < 2) {
    return <div className="h-8 w-full" />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const width = 100;
  const height = 28;
  const step = width / (points.length - 1);
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${(index * step).toFixed(2)},${(height - ((point - min) / range) * height).toFixed(2)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-8 w-full" preserveAspectRatio="none">
      <path d={path} fill="none" stroke={trendingUp ? "#f87171" : "#34d399"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const Dashboard: React.FC = () => {
  const { authToken, isAuthLoading } = useAuth();
  const { addNotification } = useNotification();
  const navigate = useNavigate();
  const location = useLocation();
  const { data, error, loading, fetchData: fetchProducts } = useApiFetcher();
  const { data: deleteResponse, fetchData: fetchDelete } = useApiFetcher();

  const [metrics, setMetrics] = useState<Record<string, ProductMetrics>>({});
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [showChartFor, setShowChartFor] = useState<Product | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [sortOption, setSortOption] = useState<SortOption>("lastChecked");
  const metricsRequestId = useRef(0);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!authToken) {
      navigate("/login", { state: { from: locationPath(location) } });
      return;
    }
    fetchProducts(ProductService.getProduct().url, ProductService.getProduct().options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, isAuthLoading]);

  const products: Product[] = useMemo(() => (data?.status === 200 && Array.isArray(data.body) ? data.body : []), [data]);

  useEffect(() => {
    if (products.length === 0) {
      setMetrics({});
      setMetricsLoading(false);
      return;
    }
    const requestId = ++metricsRequestId.current;
    setMetricsLoading(true);
    const uniqueProductIds = Array.from(new Set(products.map((product) => product.productId)));
    const { url, options } = ProductService.getPriceSummaries(uniqueProductIds);
    requestJson<Record<string, ProductMetrics>>(url, options).then((response) => {
      if (metricsRequestId.current !== requestId) return;
      setMetrics(response.status === 200 && response.body ? response.body : {});
      setMetricsLoading(false);
    });
  }, [products]);

  useEffect(() => {
    if (deleteResponse !== null && deleteResponse?.status === 200) {
      addNotification("Product deleted successfully!", "success");
      const { url, options } = ProductService.getProduct();
      fetchProducts(url, options);
    } else if (deleteResponse !== null && deleteResponse?.status !== 200) {
      addNotification(deleteResponse?.body?.message || "Failed to delete product", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteResponse]);

  const handleDelete = (productId: string, targetPrice: string) => {
    if (!authToken) return;
    const deleteRequest = ProductService.deleteProduct(productId, targetPrice);
    fetchDelete(deleteRequest.url, deleteRequest.options);
  };

  const stats = useMemo(() => {
    const distinctStores = new Set(products.map((product) => platformIdFromProductId(product.productId))).size;
    let targetReached = 0;
    let biggestDrop: { amount: number; title: string } | null = null;
    let savingsTotal = 0;
    let savingsCount = 0;

    for (const product of products) {
      const metric = metrics[product.productId];
      if (!metric) continue;
      const target = parseFloat(product.targetPrice);
      if (!Number.isNaN(target) && metric.currentPrice <= target) targetReached += 1;
      const drop = metric.peakPrice - metric.currentPrice;
      if (drop >= 0) {
        savingsTotal += drop;
        savingsCount += 1;
        if (!biggestDrop || drop > biggestDrop.amount) {
          biggestDrop = { amount: drop, title: product.productTitle || "Tracked product" };
        }
      }
    }

    return {
      trackedCount: products.length,
      distinctStores,
      targetReached,
      targetReachedPercent: products.length ? Math.round((targetReached / products.length) * 100) : 0,
      biggestDrop,
      averageSavings: savingsCount ? Math.round(savingsTotal / savingsCount) : 0,
    };
  }, [products, metrics]);

  const storeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const product of products) {
      const platformId = platformIdFromProductId(product.productId);
      counts[platformId] = (counts[platformId] || 0) + 1;
    }
    return counts;
  }, [products]);

  const visibleProducts = useMemo(() => {
    let list = products;
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      list = list.filter((product) => (product.productTitle || "").toLowerCase().includes(needle));
    }
    if (storeFilter === "target-reached") {
      list = list.filter((product) => {
        const metric = metrics[product.productId];
        const target = parseFloat(product.targetPrice);
        return metric && !Number.isNaN(target) && metric.currentPrice <= target;
      });
    } else if (storeFilter !== "all") {
      list = list.filter((product) => platformIdFromProductId(product.productId) === storeFilter);
    }

    const sorted = [...list];
    sorted.sort((a, b) => {
      const metricA = metrics[a.productId];
      const metricB = metrics[b.productId];
      if (sortOption === "priceAsc") return (metricA?.currentPrice ?? Infinity) - (metricB?.currentPrice ?? Infinity);
      if (sortOption === "priceDesc") return (metricB?.currentPrice ?? -Infinity) - (metricA?.currentPrice ?? -Infinity);
      const timeA = metricA?.lastCheckedIso ? new Date(metricA.lastCheckedIso).getTime() : 0;
      const timeB = metricB?.lastCheckedIso ? new Date(metricB.lastCheckedIso).getTime() : 0;
      return timeB - timeA;
    });
    return sorted;
  }, [products, metrics, search, storeFilter, sortOption]);

  if (isAuthLoading || loading) return <Loader />;
  if (error) return <p className="text-center text-red-500 dark:text-red-400">Failed to load products.</p>;
  if (!data || data.status !== 200 || !data.body) return null;

  return (
    <>
      <div className="min-h-screen w-full bg-slate-50 px-5 pb-20 pt-24 text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <button
            onClick={() => navigate("/pricetracker")}
            className="mb-4 flex items-center gap-2 text-sm text-slate-500 hover:text-violet-600 dark:text-slate-400 dark:hover:text-violet-300"
          >
            <ArrowLeft className="h-4 w-4" /> Track a product
          </button>

          <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Price Tracker</h1>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Monitor real-time price changes and get notified when prices drop.
              </p>
            </div>
            <button
              onClick={() => navigate("/pricetracker/add")}
              className="flex w-fit items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500"
            >
              <Plus className="h-4 w-4" /> Track product
            </button>
          </header>

          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/70">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                <Box className="h-5 w-5" />
              </div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Tracked Products</p>
              <p className="text-2xl font-bold">{stats.trackedCount}</p>
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Across {stats.distinctStores} store{stats.distinctStores === 1 ? "" : "s"}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/70">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
                <Target className="h-5 w-5" />
              </div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Target Reached</p>
              <p className="text-2xl font-bold">{stats.targetReached}</p>
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{stats.targetReachedPercent}% of total</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/70">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                <TrendingDown className="h-5 w-5" />
              </div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Biggest Drop</p>
              <p className="text-2xl font-bold">{stats.biggestDrop ? formatINR(stats.biggestDrop.amount) : "—"}</p>
              <p className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500">{stats.biggestDrop?.title || "No drops yet"}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/70">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                <Wallet className="h-5 w-5" />
              </div>
              <p className="flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                Average Savings
                <span title="Average of (highest recorded price − current price) across tracked products with price history.">
                  <Percent className="h-3 w-3 text-slate-400" />
                </span>
              </p>
              <p className="text-2xl font-bold">{formatINR(stats.averageSavings)}</p>
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Per product</p>
            </div>
          </div>

          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-900/70 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 dark:border-white/10 dark:bg-slate-950 sm:w-72">
              <Search className="h-4 w-4 flex-shrink-0 text-slate-400" />
              <input
                type="text"
                placeholder="Search tracked products…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full bg-transparent py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none dark:text-white dark:placeholder-slate-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setStoreFilter("all")}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  storeFilter === "all"
                    ? "border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-400/40 dark:bg-violet-500/15 dark:text-violet-200"
                    : "border-slate-200 text-slate-500 hover:border-slate-300 dark:border-white/10 dark:text-slate-400 dark:hover:border-white/20"
                }`}
              >
                All ({products.length})
              </button>
              <button
                onClick={() => setStoreFilter("target-reached")}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  storeFilter === "target-reached"
                    ? "border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-400/40 dark:bg-violet-500/15 dark:text-violet-200"
                    : "border-slate-200 text-slate-500 hover:border-slate-300 dark:border-white/10 dark:text-slate-400 dark:hover:border-white/20"
                }`}
              >
                Target reached ({stats.targetReached})
              </button>
              {Object.entries(storeCounts).map(([platformId, count]) => (
                <button
                  key={platformId}
                  onClick={() => setStoreFilter(platformId)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    storeFilter === platformId
                      ? "border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-400/40 dark:bg-violet-500/15 dark:text-violet-200"
                      : "border-slate-200 text-slate-500 hover:border-slate-300 dark:border-white/10 dark:text-slate-400 dark:hover:border-white/20"
                  }`}
                >
                  {platformMetaForId(platformId).label} ({count})
                </button>
              ))}

              <div className="relative">
                <select
                  value={sortOption}
                  onChange={(event) => setSortOption(event.target.value as SortOption)}
                  className="appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-7 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-slate-950 dark:text-slate-300"
                >
                  <option value="lastChecked">Sort: Last checked</option>
                  <option value="priceAsc">Sort: Price low to high</option>
                  <option value="priceDesc">Sort: Price high to low</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
          </div>

          {products.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center dark:border-white/10 dark:bg-slate-900/70">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-violet-100 text-3xl dark:bg-violet-500/15">📦</div>
              <p className="text-lg text-slate-600 dark:text-slate-300">No products tracked yet</p>
              <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">Start by adding a product from the Price Tracker</p>
            </div>
          ) : visibleProducts.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center dark:border-white/10 dark:bg-slate-900/70">
              <p className="text-slate-500 dark:text-slate-400">No tracked products match this filter.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {visibleProducts.map((product) => {
                const rowKey = product.productId + product.targetPrice;
                const meta = platformMetaForId(platformIdFromProductId(product.productId));
                const metric = metrics[product.productId];
                const target = parseFloat(product.targetPrice);
                const percentChange = metric?.previousPrice
                  ? ((metric.currentPrice - metric.previousPrice) / metric.previousPrice) * 100
                  : null;
                const reached = metric && !Number.isNaN(target) && metric.currentPrice <= target;
                const gap = metric && !Number.isNaN(target) ? Math.round(metric.currentPrice - target) : null;

                return (
                  <div
                    key={rowKey}
                    className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 transition hover:shadow-lg dark:border-white/10 dark:bg-slate-900/70"
                  >
                    <div className="mb-3 flex items-start justify-between">
                      <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${meta.badgeClass}`}>
                        {meta.letter} {meta.label}
                      </span>
                      <div className="relative">
                        <button
                          onClick={() => setOpenMenuId(openMenuId === rowKey ? null : rowKey)}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 dark:hover:bg-white/5"
                          aria-label="Product menu"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                        {openMenuId === rowKey && (
                          <div className="absolute right-0 z-20 mt-2 w-32 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-white/10 dark:bg-slate-900">
                            <button
                              onClick={() => {
                                handleDelete(product.productId, product.targetPrice);
                                setOpenMenuId(null);
                              }}
                              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-red-500 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <img
                      src={product.productImageUrl}
                      alt={product.productTitle}
                      className="mb-3 h-32 w-full rounded-lg bg-slate-50 object-contain dark:bg-slate-950"
                    />

                    <a href={product.productUrl} target="_blank" rel="noopener noreferrer">
                      <h3 className="mb-3 line-clamp-2 text-sm font-semibold text-slate-900 hover:text-violet-600 dark:text-white dark:hover:text-violet-300">
                        {product.productTitle}
                      </h3>
                    </a>

                    <div className="mt-auto space-y-2 border-t border-slate-100 pt-3 dark:border-white/5">
                      <div className="flex items-baseline justify-between">
                        <div>
                          <p className="text-[11px] font-medium text-slate-400">Current Price</p>
                          <p className="text-lg font-bold">
                            {metric ? formatINR(metric.currentPrice) : metricsLoading ? "…" : "—"}
                          </p>
                        </div>
                        {percentChange !== null && (
                          <span className={`flex items-center gap-0.5 text-xs font-semibold ${percentChange > 0 ? "text-red-500" : "text-emerald-500"}`}>
                            {percentChange > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {Math.abs(percentChange).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Target Price: {Number.isNaN(target) ? "—" : formatINR(target)}
                      </p>
                      {metric && !Number.isNaN(target) && (
                        <p className={`flex items-center gap-1.5 text-xs font-medium ${reached ? "text-emerald-500" : "text-amber-500"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${reached ? "bg-emerald-500" : "bg-amber-500"}`} />
                          {reached ? "Target reached! 🎉" : `${formatINR(Math.abs(gap ?? 0))} above target`}
                        </p>
                      )}
                      {metric && <Sparkline points={metric.sparkline} trendingUp={(percentChange ?? 0) > 0} />}
                      <div className="flex items-center justify-between pt-1">
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <Clock3 className="h-3 w-3" /> Last checked: {relativeTime(metric?.lastCheckedIso ?? null)}
                        </span>
                        <button
                          onClick={() => setShowChartFor(product)}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-500 transition hover:border-violet-400 hover:text-violet-600 dark:border-white/10 dark:text-slate-300 dark:hover:border-violet-400/40 dark:hover:text-violet-300"
                        >
                          View history
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showChartFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 transition-colors duration-300 dark:bg-black/60">
          <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-slate-900">
            <button
              onClick={() => setShowChartFor(null)}
              className="absolute right-4 top-4 z-10 rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"
              aria-label="Close"
            >
              ✕
            </button>
            <h2 className="mb-6 pr-8 text-2xl font-bold text-slate-900 dark:text-white">{showChartFor.productTitle}</h2>
            <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">Price History</p>
            <div className="overflow-visible">
              <PriceChart productId={showChartFor.productId} />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Dashboard;

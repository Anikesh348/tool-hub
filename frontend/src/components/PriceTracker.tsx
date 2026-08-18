import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { SearchService } from "../apis/search/search";
import { ProductService } from "../apis/product/product";
import { useApiFetcher } from "../hooks/useApiFetcher";
import { requestJson } from "../utils/apiRequest";
import { Loader } from "./Loader";
import { PromptModel } from "./PromptModal";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Lock,
  Link2,
  Search,
  Target,
  TrendingDown,
} from "lucide-react";
import { useNotification } from "../context/NotificationContext";
import type { SearchPlatform } from "../apis/search/search";
import { locationPath } from "../utils/authRedirect";
import {
  PLATFORMS,
  PRIMARY_SEARCH_PLATFORMS,
  detectPlatformFromUrl,
  platformMetaForId,
} from "../utils/storePlatforms";

interface SearchResultItem {
  title: string;
  product_url: string;
  image_url: string;
  price: string;
  platform: SearchPlatform;
}

const formatINR = (price: number): string =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(price);

const parsePrice = (price: string): number => parseFloat(String(price).replace(/[^0-9.]/g, "")) || 0;

const RESULTS_PAGE_SIZE = 6;

const PriceTracker = () => {
  const { isAuthenticated } = useAuth();
  const { addNotification } = useNotification();
  const navigate = useNavigate();
  const location = useLocation();

  const { loading: isProductLoading, data: productData, fetchData: productFetchData } = useApiFetcher();

  const [viewMode, setViewMode] = useState<"search" | "paste">(() =>
    location.pathname === "/pricetracker/search" ? "search" : "paste"
  );

  // --- Paste-link tab state ---
  const [productUrl, setProductUrl] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const detectedPlatform = useMemo(() => detectPlatformFromUrl(productUrl.trim()), [productUrl]);

  // --- Search-stores tab state ---
  const [query, setQuery] = useState("");
  const [storeFilter, setStoreFilter] = useState<SearchPlatform | "all">("all");
  const [moreStoresOpen, setMoreStoresOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE);
  const [selectedResult, setSelectedResult] = useState<SearchResultItem | null>(null);
  const [selectedTargetPrice, setSelectedTargetPrice] = useState("");
  const searchRequestId = useRef(0);

  const [modelInfo, setModelInfo] = useState({ modelType: "", isSuccess: false, isOpen: false, message: "" });

  useEffect(() => {
    setViewMode(location.pathname === "/pricetracker/search" ? "search" : "paste");
  }, [location.pathname]);

  const runSearch = useCallback(
    async (platformFilter: SearchPlatform | "all") => {
      const trimmed = query.trim();
      if (!trimmed) return;
      const requestId = ++searchRequestId.current;
      setSearchLoading(true);
      setSearchError("");
      setVisibleCount(RESULTS_PAGE_SIZE);

      const platforms = platformFilter === "all" ? PRIMARY_SEARCH_PLATFORMS : [platformFilter];
      const settled = await Promise.allSettled(
        platforms.map(async (platform) => {
          const { url, options } = SearchService.search(trimmed, platform);
          const response = await requestJson<{ results?: Array<Omit<SearchResultItem, "platform">> }>(url, options);
          if (response.status !== 200 || !response.body?.results) return [] as SearchResultItem[];
          return response.body.results.map((item) => ({ ...item, platform }));
        })
      );

      if (searchRequestId.current !== requestId) return;

      const merged = settled.flatMap((outcome) => (outcome.status === "fulfilled" ? outcome.value : []));
      if (merged.length === 0 && settled.every((outcome) => outcome.status === "rejected")) {
        setSearchError("Failed to fetch results. Please try again.");
      }
      setResults(merged);
      setHasSearched(true);
      setSearchLoading(false);
    },
    [query]
  );

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void runSearch(storeFilter);
  };

  const handleStoreFilterClick = (next: SearchPlatform | "all") => {
    setStoreFilter(next);
    setMoreStoresOpen(false);
    if (query.trim()) void runSearch(next);
  };

  const sortedResults = useMemo(() => {
    const copy = [...results];
    copy.sort((a, b) => (sortOrder === "asc" ? parsePrice(a.price) - parsePrice(b.price) : parsePrice(b.price) - parsePrice(a.price)));
    return copy;
  }, [results, sortOrder]);

  const cheapestUrl = useMemo(() => {
    if (results.length < 2) return null;
    const distinctPlatforms = new Set(results.map((item) => item.platform));
    if (distinctPlatforms.size < 2) return null;
    return results.reduce((min, item) => (parsePrice(item.price) < parsePrice(min.price) ? item : min), results[0]).product_url;
  }, [results]);

  const visibleResults = sortedResults.slice(0, visibleCount);

  const handleProtectedAction = (nextTargetPrice: string, nextProductUrl: string) => {
    if (!isAuthenticated) {
      setModelInfo({ modelType: "login", isSuccess: true, isOpen: true, message: "" });
      return;
    }
    const { url, options } = ProductService.addProduct(nextProductUrl, nextTargetPrice);
    productFetchData(url, options);
  };

  const handlePasteSubmit = () => {
    if (productUrl.trim() !== "" && targetPrice.trim() !== "") handleProtectedAction(targetPrice, productUrl);
  };

  const handleTrackSelected = () => {
    if (selectedResult && selectedTargetPrice.trim() !== "") {
      handleProtectedAction(selectedTargetPrice, selectedResult.product_url);
    }
  };

  useEffect(() => {
    if (productData == null) return;
    if (productData?.status === 200) {
      addNotification("Product added successfully! You'll be notified when the price drops.", "success");
      setProductUrl("");
      setTargetPrice("");
      setSelectedResult(null);
      setSelectedTargetPrice("");
    } else if (productData?.status === 400) {
      addNotification("Product with this target price already exists", "warning");
    } else {
      addNotification(productData?.body?.message || "Error adding the product", "error");
    }
  }, [productData, addNotification]);

  const handleLogin = () => {
    setModelInfo({ modelType: "", isSuccess: false, isOpen: false, message: "" });
    navigate("/login", { state: { from: locationPath(location) } });
  };

  const otherPlatforms = PLATFORMS.filter((platform) => !PRIMARY_SEARCH_PLATFORMS.slice(0, 4).includes(platform.id));

  return (
    <div className="min-h-screen w-full bg-slate-50 px-5 pb-20 pt-24 text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Track a product</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Paste a product link or search stores, set a target price, and get notified when the price drops.
            </p>
          </div>
          {isAuthenticated && (
            <button
              onClick={() => navigate("/pricetracker/dashboard")}
              className="flex w-fit items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-violet-400 hover:text-violet-600 dark:border-white/10 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-violet-400/40 dark:hover:text-violet-300"
            >
              <BarChart3 className="h-4 w-4" />
              View dashboard
            </button>
          )}
        </header>

        <div className="mb-6 flex gap-6 border-b border-slate-200 dark:border-white/10">
          <button
            onClick={() => navigate("/pricetracker/add")}
            className={`flex items-center gap-2 border-b-2 pb-3 text-sm font-semibold transition ${
              viewMode === "paste"
                ? "border-violet-600 text-violet-600 dark:border-violet-400 dark:text-violet-300"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <Link2 className="h-4 w-4" /> Paste link
          </button>
          <button
            onClick={() => navigate("/pricetracker/search")}
            className={`flex items-center gap-2 border-b-2 pb-3 text-sm font-semibold transition ${
              viewMode === "search"
                ? "border-violet-600 text-violet-600 dark:border-violet-400 dark:text-violet-300"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <Search className="h-4 w-4" /> Search stores
          </button>
        </div>

        <PromptModel
          modelInfo={modelInfo}
          onClose={() => setModelInfo((prev) => ({ ...prev, isOpen: false }))}
          onLogin={handleLogin}
        />

        {viewMode === "paste" ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-slate-900/70">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                  <Link2 className="h-4 w-4" />
                </span>
                <h2 className="text-base font-semibold">1. Paste product link</h2>
              </div>
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                Supported stores: {PLATFORMS.slice(0, 8).map((platform) => platform.label).join(", ")}
              </p>
              <input
                type="text"
                placeholder="Paste product URL from Amazon, Flipkart, Myntra, Nykaa, Ajio, Tata CLiQ, Croma, or Meesho"
                value={productUrl}
                onChange={(event) => setProductUrl(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:placeholder-slate-500"
              />
              {productUrl.trim() !== "" && (
                <div className="mt-3">
                  {detectedPlatform ? (
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${detectedPlatform.badgeClass}`}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Detected: {detectedPlatform.label}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-500 dark:text-amber-400">
                      We couldn't recognize this store from the URL
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-slate-900/70">
              <div className="mb-1 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                  <Target className="h-4 w-4" />
                </span>
                <h2 className="text-base font-semibold">2. Set your target price</h2>
              </div>
              <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
                We'll notify you when the price drops to or below this amount.
              </p>
              <div className="flex items-center rounded-xl border border-slate-200 bg-white px-4 focus-within:border-transparent focus-within:ring-2 focus-within:ring-violet-500 dark:border-white/10 dark:bg-slate-950">
                <span className="text-sm text-slate-400">₹</span>
                <input
                  type="number"
                  placeholder="Enter target price"
                  value={targetPrice}
                  onChange={(event) => setTargetPrice(event.target.value)}
                  className="w-full bg-transparent py-3 pl-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none dark:text-white dark:placeholder-slate-500"
                />
              </div>

              <button
                onClick={handlePasteSubmit}
                disabled={isProductLoading || !productUrl.trim() || !targetPrice.trim()}
                className={`mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition ${
                  productUrl.trim() && targetPrice.trim()
                    ? "bg-violet-600 text-white hover:bg-violet-500"
                    : "cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
                }`}
              >
                {isProductLoading ? "Adding..." : isAuthenticated ? "Start tracking" : "Log in to track"}
                {!isProductLoading && <ArrowRight className="h-4 w-4" />}
              </button>

              {!isAuthenticated && (
                <p className="mt-3 flex items-center justify-center gap-2 text-center text-xs text-amber-600 dark:text-amber-400">
                  <Lock className="h-3.5 w-3.5" /> Log in to save products and receive price alerts.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/70 sm:p-6">
              <form onSubmit={handleSearchSubmit} className="mb-4 flex gap-2">
                <div className="flex flex-1 items-center rounded-xl border border-slate-200 bg-white px-3 focus-within:border-transparent focus-within:ring-2 focus-within:ring-violet-500 dark:border-white/10 dark:bg-slate-950">
                  <Search className="h-4 w-4 flex-shrink-0 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search for a product…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="w-full bg-transparent px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none dark:text-white dark:placeholder-slate-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!query.trim()}
                  className="rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
                >
                  Search
                </button>
              </form>

              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleStoreFilterClick("all")}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      storeFilter === "all"
                        ? "border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-400/40 dark:bg-violet-500/15 dark:text-violet-200"
                        : "border-slate-200 text-slate-500 hover:border-slate-300 dark:border-white/10 dark:text-slate-400 dark:hover:border-white/20"
                    }`}
                  >
                    All
                  </button>
                  {PRIMARY_SEARCH_PLATFORMS.slice(0, 3).map((id) => {
                    const meta = platformMetaForId(id);
                    return (
                      <button
                        key={id}
                        onClick={() => handleStoreFilterClick(id)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                          storeFilter === id
                            ? "border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-400/40 dark:bg-violet-500/15 dark:text-violet-200"
                            : "border-slate-200 text-slate-500 hover:border-slate-300 dark:border-white/10 dark:text-slate-400 dark:hover:border-white/20"
                        }`}
                      >
                        {meta.label}
                      </button>
                    );
                  })}
                  <div className="relative">
                    <button
                      onClick={() => setMoreStoresOpen((open) => !open)}
                      className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        otherPlatforms.some((platform) => platform.id === storeFilter)
                          ? "border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-400/40 dark:bg-violet-500/15 dark:text-violet-200"
                          : "border-slate-200 text-slate-500 hover:border-slate-300 dark:border-white/10 dark:text-slate-400 dark:hover:border-white/20"
                      }`}
                    >
                      {otherPlatforms.find((platform) => platform.id === storeFilter)?.label || "More"}
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {moreStoresOpen && (
                      <div className="absolute left-0 z-20 mt-2 max-h-64 w-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-white/10 dark:bg-slate-900">
                        {otherPlatforms.map((platform) => (
                          <button
                            key={platform.id}
                            onClick={() => handleStoreFilterClick(platform.id)}
                            className={`block w-full rounded-lg px-3 py-2 text-left text-xs font-medium transition ${
                              storeFilter === platform.id
                                ? "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200"
                                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
                            }`}
                          >
                            {platform.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <select
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value as "asc" | "desc")}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-slate-950 dark:text-slate-300"
                >
                  <option value="asc">Sort by: Price: Low to High</option>
                  <option value="desc">Sort by: Price: High to Low</option>
                </select>
              </div>

              <div className="flex flex-col gap-3">
                {searchLoading ? (
                  <Loader />
                ) : searchError ? (
                  <p className="py-4 text-center text-xs text-red-500 dark:text-red-400">{searchError}</p>
                ) : visibleResults.length > 0 ? (
                  <>
                    {hasSearched && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Showing {visibleResults.length} of {results.length} results for "{query}"
                      </p>
                    )}
                    {visibleResults.map((result, index) => {
                      const meta = platformMetaForId(result.platform);
                      const isSelected = selectedResult?.product_url === result.product_url;
                      const isBestPrice = cheapestUrl === result.product_url;
                      return (
                        <div
                          key={`${result.product_url}-${index}`}
                          className={`flex flex-col gap-4 rounded-xl border p-4 transition sm:flex-row sm:items-center ${
                            isSelected
                              ? "border-violet-500 bg-violet-50/60 dark:border-violet-400/50 dark:bg-violet-500/10"
                              : "border-slate-200 bg-white hover:border-violet-300 dark:border-white/10 dark:bg-slate-950/60 dark:hover:border-violet-400/30"
                          }`}
                        >
                          <img
                            src={result.image_url}
                            alt={result.title}
                            className="h-16 w-16 flex-shrink-0 rounded-lg bg-white object-contain dark:bg-slate-900"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-center gap-2">
                              <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${meta.badgeClass}`}>
                                {meta.letter} {meta.label}
                              </span>
                              {isBestPrice && (
                                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-500 dark:text-emerald-400">
                                  Best Price
                                </span>
                              )}
                            </div>
                            <a href={result.product_url} target="_blank" rel="noreferrer">
                              <h3 className="line-clamp-2 text-sm font-semibold text-slate-900 hover:text-violet-600 dark:text-white dark:hover:text-violet-300">
                                {result.title}
                              </h3>
                            </a>
                            <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">{formatINR(parsePrice(result.price))}</p>
                          </div>
                          <button
                            onClick={() => {
                              setSelectedResult(result);
                              setSelectedTargetPrice("");
                            }}
                            className="flex-shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500"
                          >
                            Track price
                          </button>
                        </div>
                      );
                    })}
                    {visibleCount < sortedResults.length && (
                      <button
                        onClick={() => setVisibleCount((count) => count + RESULTS_PAGE_SIZE)}
                        className="mt-1 flex items-center justify-center gap-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-500 transition hover:border-violet-300 hover:text-violet-600 dark:border-white/10 dark:text-slate-400 dark:hover:border-violet-400/30 dark:hover:text-violet-300"
                      >
                        Load more results <ChevronDown className="h-4 w-4" />
                      </button>
                    )}
                  </>
                ) : hasSearched ? (
                  <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                    No results found. Try a different search term or store.
                  </p>
                ) : (
                  <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                    Select a store (or "All") and search to get started
                  </p>
                )}
              </div>
            </div>

            <div className="h-fit rounded-2xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-slate-900/70 lg:sticky lg:top-24">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                  <Target className="h-4 w-4" />
                </span>
                <h2 className="text-base font-semibold">Set your target price</h2>
              </div>

              {selectedResult ? (
                <>
                  <p className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Selected product</p>
                  <div className="mb-4 flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-white/10">
                    <img
                      src={selectedResult.image_url}
                      alt={selectedResult.title}
                      className="h-12 w-12 flex-shrink-0 rounded-lg bg-white object-contain dark:bg-slate-900"
                    />
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-xs font-semibold text-slate-900 dark:text-white">{selectedResult.title}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${platformMetaForId(selectedResult.platform).badgeClass}`}>
                          {platformMetaForId(selectedResult.platform).label}
                        </span>
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{formatINR(parsePrice(selectedResult.price))}</span>
                      </div>
                    </div>
                  </div>

                  <label className="mb-2 block text-xs font-semibold text-slate-500 dark:text-slate-400">Enter target price</label>
                  <div className="flex items-center rounded-xl border border-slate-200 bg-white px-4 focus-within:border-transparent focus-within:ring-2 focus-within:ring-violet-500 dark:border-white/10 dark:bg-slate-950">
                    <span className="text-sm text-slate-400">₹</span>
                    <input
                      type="number"
                      placeholder="Enter target price"
                      value={selectedTargetPrice}
                      onChange={(event) => setSelectedTargetPrice(event.target.value)}
                      className="w-full bg-transparent py-3 pl-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none dark:text-white dark:placeholder-slate-500"
                    />
                  </div>

                  <p className="mb-2 mt-4 text-xs font-semibold text-slate-500 dark:text-slate-400">Quick suggestions</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[0.95, 0.9].map((factor) => {
                      const amount = Math.round(parsePrice(selectedResult.price) * factor);
                      return (
                        <button
                          key={factor}
                          onClick={() => setSelectedTargetPrice(String(amount))}
                          className="rounded-lg border border-slate-200 py-2 text-center text-xs font-semibold text-slate-600 transition hover:border-violet-400 hover:text-violet-600 dark:border-white/10 dark:text-slate-300 dark:hover:border-violet-400/40 dark:hover:text-violet-300"
                        >
                          {Math.round((1 - factor) * 100)}% lower
                          <span className="mt-0.5 block text-[11px] font-normal text-slate-400">{formatINR(amount)}</span>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    onClick={handleTrackSelected}
                    disabled={isProductLoading || !selectedTargetPrice.trim()}
                    className={`mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition ${
                      selectedTargetPrice.trim()
                        ? "bg-violet-600 text-white hover:bg-violet-500"
                        : "cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
                    }`}
                  >
                    {isProductLoading ? "Adding..." : isAuthenticated ? "Start tracking" : "Log in to track"}
                    {!isProductLoading && <ArrowRight className="h-4 w-4" />}
                  </button>
                  {!isAuthenticated && (
                    <p className="mt-3 flex items-center justify-center gap-2 text-center text-xs text-amber-600 dark:text-amber-400">
                      <Lock className="h-3.5 w-3.5" /> Log in to save products and receive price alerts.
                    </p>
                  )}
                </>
              ) : (
                <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  Pick "Track price" on a result to set its target price here.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="mt-10 grid gap-6 border-t border-slate-200 pt-8 dark:border-white/10 sm:grid-cols-3">
          {[
            { icon: Link2, step: 1, title: "Paste a link or search", body: "Add a product link or search across supported stores." },
            { icon: Target, step: 2, title: "Set your target price", body: "Choose your ideal price and let ToolHub do the tracking." },
            { icon: BellRing, step: 3, title: "Get price drop alerts", body: "Receive an alert the moment the price drops to your target." },
          ].map((item, index, all) => (
            <div key={item.step} className="flex items-start gap-2">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                  <item.icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold">
                    {item.step} {item.title}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.body}</p>
                </div>
              </div>
              {index < all.length - 1 && (
                <ChevronRight className="mt-3 hidden h-4 w-4 flex-shrink-0 text-slate-300 dark:text-slate-700 sm:block" />
              )}
            </div>
          ))}
        </div>

        <p className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-center text-xs text-slate-500 dark:text-slate-500">
          <span className="flex items-center gap-1.5">
            <Clock3 className="h-3.5 w-3.5" /> We monitor prices 24/7 so you don't have to.
          </span>
          <span className="hidden sm:inline">|</span>
          <span className="flex items-center gap-1.5">
            <TrendingDown className="h-3.5 w-3.5" /> Your data is private and never shared.
          </span>
        </p>
      </div>
    </div>
  );
};

export default PriceTracker;

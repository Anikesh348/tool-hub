import React, { useEffect, useState } from "react";
import { SearchResultCard } from "./SearchResultCard";
import { SearchBar } from "./SearchBar";
import { useAuth } from "../context/AuthContext";
import { SearchService } from "../apis/search/search";
import { ProductService } from "../apis/product/product";
import { useApiFetcher } from "../hooks/useApiFetcher";
import { Loader } from "./Loader";
import { PromptModel } from "./PromptModal";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  BellRing,
  Link2,
  Search,
  TrendingDown,
} from "lucide-react";
import { useNotification } from "../context/NotificationContext";
import type { SearchPlatform } from "../apis/search/search";

const searchPlatforms: { id: SearchPlatform; label: string; tone: string }[] = [
  { id: "amazon", label: "Amazon", tone: "yellow" },
  { id: "flipkart", label: "Flipkart", tone: "blue" },
  { id: "myntra", label: "Myntra", tone: "pink" },
  { id: "nykaa", label: "Nykaa", tone: "rose" },
  { id: "ajio", label: "Ajio", tone: "indigo" },
  { id: "tatacliq", label: "Tata CLiQ", tone: "red" },
  { id: "croma", label: "Croma", tone: "green" },
  { id: "meesho", label: "Meesho", tone: "purple" },
  { id: "shopsy", label: "Shopsy", tone: "blue" },
  { id: "snapdeal", label: "Snapdeal", tone: "red" },
  { id: "firstcry", label: "FirstCry", tone: "yellow" },
  { id: "bigbasket", label: "BigBasket", tone: "green" },
  { id: "reliancedigital", label: "Reliance Digital", tone: "indigo" },
  { id: "vijaysales", label: "Vijay Sales", tone: "rose" },
  { id: "jiomart", label: "JioMart", tone: "purple" },
];

const PriceTracker = () => {
  const { isAuthenticated, updateSearchState, searchResults } = useAuth();
  const { addNotification } = useNotification();
  const navigate = useNavigate();
  const location = useLocation();
  const { loading, data, error, fetchData } = useApiFetcher();

  const {
    loading: isProductLoading,
    data: productData,
    fetchData: productFetchData,
  } = useApiFetcher();

  const [clickedProduct, setClickedProduct] = useState("");
  const [viewMode, setViewMode] = useState<"search" | "paste">(() =>
    location.pathname === "/pricetracker/search" ? "search" : "paste"
  );
  const [productUrl, setProductUrl] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState<SearchPlatform | "">("");

  const [modelInfo, setModelInfo] = useState({
    modelType: "",
    isSuccess: false,
    isOpen: false,
    message: "",
  });

  useEffect(() => {
    setViewMode(
      location.pathname === "/pricetracker/search" ? "search" : "paste"
    );
  }, [location.pathname]);

  const handleSearch = (query: string) => {
    if (query !== "" && selectedPlatform !== "") {
      const { url, options } = SearchService.search(query, selectedPlatform);
      fetchData(url, options);
    } else {
      updateSearchState([]);
    }
  };

  const handleProtectedAction = (targetPrice: string, productUrl: string) => {
    if (!isAuthenticated) {
      setModelInfo({
        modelType: "login",
        isSuccess: true,
        isOpen: true,
        message: "",
      });
    } else {
      setClickedProduct(productUrl);
      const { url, options } = ProductService.addProduct(
        productUrl,
        targetPrice
      );
      productFetchData(url, options);
    }
  };

  const handlePasteSubmit = () => {
    if (productUrl.trim() !== "" && targetPrice.trim() !== "") {
      handleProtectedAction(targetPrice, productUrl);
    }
  };

  useEffect(() => {
    if (productData != null) {
      setClickedProduct("");
      if (productData?.status === 200) {
        addNotification(
          "Product added successfully! You'll be notified when the price drops.",
          "success"
        );
        setProductUrl("");
        setTargetPrice("");
      } else if (productData?.status === 400) {
        addNotification(
          "Product with this target price already exists",
          "warning"
        );
      } else {
        addNotification(
          productData?.body?.message || "Error adding the product",
          "error"
        );
      }
    }
  }, [productData, addNotification]);

  const handleLogin = () => {
    setModelInfo({
      modelType: "",
      isSuccess: false,
      isOpen: false,
      message: "",
    });
  };

  useEffect(() => {
    if (data != null && data?.status === 200) {
      updateSearchState(data?.body?.results || []);
    }
  }, [data, error]);

  return (
    <div className="portal-page price-tracker-workspace min-h-screen w-full transition-colors duration-300">
      <div className="toolhub-desktop-container max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8 pt-24">
        <header className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="tool-workspace-kicker">Price intelligence</p>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Price Tracker
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Add a product or search supported stores, set your target, and let
              ToolHub monitor the price.
            </p>
          </div>
          {isAuthenticated && (
            <button
              onClick={() => navigate("/pricetracker/dashboard")}
              className="portal-secondary-button"
            >
              <BarChart3 className="h-4 w-4" />
              Open dashboard
            </button>
          )}
        </header>

        <div className="tool-metric-grid mb-6">
          <div className="tool-metric-card">
            <Link2 />
            <span><strong>Paste</strong>Any supported product URL</span>
          </div>
          <div className="tool-metric-card">
            <TrendingDown />
            <span><strong>Target</strong>Choose the price you want</span>
          </div>
          <div className="tool-metric-card">
            <BellRing />
            <span><strong>Alert</strong>Get notified when it drops</span>
          </div>
        </div>

        <div className="price-mode-switch">
          <button
            onClick={() => navigate("/pricetracker/add")}
            className={viewMode === "paste" ? "price-mode-active" : ""}
          >
            <Link2 className="h-4 w-4" />
            Paste URL
          </button>
          <button
            onClick={() => navigate("/pricetracker/search")}
            className={viewMode === "search" ? "price-mode-active" : ""}
          >
            <Search className="h-4 w-4" />
            Search stores
          </button>
        </div>

        <PromptModel
          modelInfo={modelInfo}
          onClose={() =>
            setModelInfo((prev) => ({
              ...prev,
              isOpen: false,
            }))
          }
          onLogin={handleLogin}
        />

        {viewMode === "search" ? (
          <div className="tool-workspace-card p-5 sm:p-7">
            {/* Platform Selection */}
            <div className="mb-5">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Select Platform
              </p>
              <select
                value={selectedPlatform}
                onChange={(event) =>
                  setSelectedPlatform(event.target.value as SearchPlatform | "")
                }
                className="tool-select"
              >
                <option value="">Choose a store</option>
                {searchPlatforms.map((platform) => (
                  <option key={platform.id} value={platform.id}>
                    {platform.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Search Bar */}
            <div className="mb-5">
              <SearchBar
                onSearch={handleSearch}
                isDisabled={selectedPlatform === ""}
              />
            </div>

            {/* Results */}
            <div className="flex flex-col gap-3">
              {loading ? (
                <Loader />
              ) : error !== null ? (
                <p className="text-center text-red-500 dark:text-red-400 py-4 text-xs">
                  Failed to fetch results. Please try again.
                </p>
              ) : searchResults.length > 0 ? (
                searchResults.map((result, index) => (
                  <SearchResultCard
                    key={index}
                    product={result}
                    handleProtectedAction={handleProtectedAction}
                    loading={
                      isProductLoading && result.product_url === clickedProduct
                    }
                  />
                ))
              ) : (
                <p className="text-center text-gray-500 dark:text-gray-400 py-8">
                  Select a platform and search to get started
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="tool-workspace-card p-5 sm:p-7">
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
              <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Product URL
              </label>
              <input
                type="text"
                placeholder="Paste Amazon, Flipkart, Myntra, Nykaa, Ajio, Tata CLiQ, Croma, or Meesho URL"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Supported: Amazon, Flipkart, Myntra, Nykaa, Ajio, Tata CLiQ,
                Croma, Meesho
              </p>
              </div>
              <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Target Price (₹)
              </label>
              <input
                type="number"
                placeholder="Enter your desired price"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
              </div>
            </div>

            <button
              onClick={handlePasteSubmit}
              disabled={
                isProductLoading ||
                !productUrl.trim() ||
                !targetPrice.trim()
              }
              className={`w-full mt-5 py-2 text-sm rounded-lg font-semibold transition-all ${
                productUrl.trim() && targetPrice.trim()
                  ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:shadow-lg active:scale-95"
                  : "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
              }`}
            >
              {isProductLoading ? "Adding..." : isAuthenticated ? "Start Tracking" : "Log in to track"}
              {!isProductLoading && <ArrowRight className="ml-2 inline h-4 w-4" />}
            </button>

            {!isAuthenticated && (
              <p className="text-sm text-center text-orange-500 dark:text-orange-400 mt-4 flex items-center justify-center gap-2">
                Log in to save products and receive price alerts.
              </p>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

export default PriceTracker;

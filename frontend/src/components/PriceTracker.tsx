import React, { useEffect, useState } from "react";
import { SearchResultCard } from "./SearchResultCard";
import { SearchBar } from "./SearchBar";
import { useAuth } from "../context/AuthContext";
import { SearchService } from "../apis/search/search";
import { ProductService } from "../apis/product/product";
import { useApiFetcher } from "../hooks/useApiFetcher";
import { Loader } from "./Loader";
import { PromptModel } from "./PromptModal";
import { useNavigate } from "react-router-dom";
import { BarChart3 } from "lucide-react";
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
  const { loading, data, error, fetchData } = useApiFetcher();

  const {
    loading: isProductLoading,
    data: productData,
    fetchData: productFetchData,
  } = useApiFetcher();

  const [clickedProduct, setClickedProduct] = useState("");
  const [viewMode, setViewMode] = useState<"search" | "paste">("paste");
  const [productUrl, setProductUrl] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState<SearchPlatform | "">("");

  const [modelInfo, setModelInfo] = useState({
    modelType: "",
    isSuccess: false,
    isOpen: false,
    message: "",
  });

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
    <div className="min-h-screen w-full landing-bg transition-colors duration-300">
      <div className="max-w-5xl mx-auto py-6 px-4 sm:px-6 lg:px-8 pt-20">
        <header className="mb-6 text-center">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight drop-shadow-lg">
            Amazon Price Drop Tracker - Real-Time Price Monitoring
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
            Track price drops across popular ecommerce sites. Paste product URLs
            or search to monitor prices in real-time and receive instant
            notifications when prices drop. Your ultimate price tracking tool.
          </p>
        </header>

        {/* View Mode Tabs */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <button
            onClick={() => setViewMode("paste")}
            className={`px-6 py-3 rounded-full text-sm font-semibold transition-all ${
              viewMode === "paste"
                ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg"
                : "glass-card border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:shadow-md"
            }`}
          >
            Paste URL
          </button>
          <button
            onClick={() => setViewMode("search")}
            className={`px-6 py-3 rounded-full text-sm font-semibold transition-all ${
              viewMode === "search"
                ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg"
                : "glass-card border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:shadow-md"
            }`}
          >
            Search Products
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
          <div className="glass-card border border-gray-200 dark:border-gray-700 rounded-lg p-6 max-w-2xl mx-auto">
            {/* Platform Selection */}
            <div className="mb-5">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-3">
                Select Platform
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {searchPlatforms.map((platform) => (
                  <button
                    key={platform.id}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all text-xs ${
                      selectedPlatform === platform.id
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-md"
                        : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                    }`}
                    onClick={() => setSelectedPlatform(platform.id)}
                  >
                    <span className="w-4 h-4 flex items-center justify-center font-bold text-blue-600 dark:text-blue-400 text-sm">
                      {platform.label.charAt(0)}
                    </span>
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {platform.label}
                    </span>
                  </button>
                ))}
              </div>
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
          <div className="glass-card border border-gray-200 dark:border-gray-700 rounded-lg p-6 max-w-2xl mx-auto">
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

            <div className="mt-4">
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

            <button
              onClick={handlePasteSubmit}
              disabled={
                !isAuthenticated ||
                isProductLoading ||
                !productUrl.trim() ||
                !targetPrice.trim()
              }
              className={`w-full mt-5 py-2 text-sm rounded-lg font-semibold transition-all ${
                isAuthenticated && productUrl.trim() && targetPrice.trim()
                  ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:shadow-lg active:scale-95"
                  : "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
              }`}
            >
              {isProductLoading ? "Adding..." : "Start Tracking"}
            </button>

            {!isAuthenticated && (
              <p className="text-sm text-center text-orange-500 dark:text-orange-400 mt-4 flex items-center justify-center gap-2">
                <span>🔒</span> Please log in to track a product
              </p>
            )}
          </div>
        )}

        {/* Dashboard Section */}
        {isAuthenticated && (
          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
            <div
              onClick={() => navigate("/pricetracker/dashboard")}
              className="group glass-card border border-blue-200/50 dark:border-blue-400/30 rounded-xl p-5 hover:shadow-xl hover:border-blue-300 dark:hover:border-blue-400/60 transition-all duration-300 cursor-pointer transform hover:scale-102"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <BarChart3 className="w-4 h-4 text-blue-600 dark:text-blue-400 group-hover:text-blue-700 dark:group-hover:text-blue-300 transition" />
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">
                      View Dashboard
                    </h3>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-300 group-hover:text-gray-700 dark:group-hover:text-gray-200 transition">
                    Track monitored products, view price history, and manage
                    your watchlist
                  </p>
                </div>
                <div className="hidden sm:block">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center group-hover:shadow-lg group-hover:scale-110 transition transform flex-shrink-0">
                    <BarChart3 className="w-6 h-6 text-white" />
                  </div>
                </div>
              </div>

              <div className="mt-3 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 text-white text-xs font-semibold group-hover:shadow-lg group-hover:from-blue-700 group-hover:to-purple-700 transition">
                Go to Dashboard →
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PriceTracker;

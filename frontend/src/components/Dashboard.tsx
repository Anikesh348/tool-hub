import React, { useEffect, useState } from "react";
import { useApiFetcher } from "../hooks/useApiFetcher";
import { useAuth } from "../context/AuthContext";
import PriceChart from "./PriceChart";
import { Loader } from "./Loader";
import { useNavigate } from "react-router-dom";
import { ProductService } from "../apis/product/product";
import { ArrowLeft } from "lucide-react";
import { useNotification } from "../context/NotificationContext";

const amazonIcon =
  "https://upload.wikimedia.org/wikipedia/commons/4/4a/Amazon_icon.svg";
const flipkartIcon =
  "https://uxwing.com/wp-content/themes/uxwing/download/brands-and-social-media/flipkart-icon.png";

const platformLabels: Record<string, string> = {
  amazon: "Amazon",
  flipkart: "Flipkart",
  myntra: "Myntra",
  nykaa: "Nykaa",
  ajio: "Ajio",
  tatacliq: "Tata CLiQ",
  croma: "Croma",
  meesho: "Meesho",
};

const getPlatformKey = (productId: string): string => productId.split("_")[0] || "product";

interface Product {
  productImageUrl: string;
  productTitle: string;
  targetPrice: string;
  productUrl: string;
  productId: string;
}

const formatINR = (price: string | number): string => {
  const amount = typeof price === "string" ? parseFloat(price) : price;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
};

const Dashboard: React.FC = () => {
  const { authToken, isAuthLoading } = useAuth();
  const { addNotification } = useNotification();
  const navigate = useNavigate();
  const { data, error, loading, fetchData: fetchProducts } = useApiFetcher();
  const { data: deleteResponse, fetchData: fetchDelete } = useApiFetcher();
  const [showChartFor, setShowChartFor] = useState<Product | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthLoading) return;

    if (!authToken) {
      navigate("/login");
      return;
    }

    fetchProducts(
      ProductService.getProduct().url,
      ProductService.getProduct().options
    );
  }, [authToken, isAuthLoading, fetchProducts, navigate]);

  useEffect(() => {
    if (deleteResponse !== null && deleteResponse?.status === 200) {
      addNotification("Product deleted successfully!", "success");
      const { url, options } = ProductService.getProduct();
      fetchProducts(url, options);
    } else if (deleteResponse !== null && deleteResponse?.status !== 200) {
      addNotification(
        deleteResponse?.body?.message || "Failed to delete product",
        "error"
      );
    }
  }, [deleteResponse, addNotification, fetchProducts]);

  const handleDelete = async (productId: string, targetPrice: string) => {
    if (!authToken) return;
    try {
      const deleteRequest = ProductService.deleteProduct(
        productId,
        targetPrice
      );
      fetchDelete(deleteRequest.url, deleteRequest.options);
    } catch (err) {
      console.error("Error deleting product:", err);
    }
  };

  if (isAuthLoading || loading) return <Loader />;
  if (error)
    return (
      <p className="text-center text-red-500 dark:text-red-400">
        Failed to load products.
      </p>
    );
  if (!data || data.status !== 200 || !data.body) return null;

  return (
    <>
      <div className="portal-page min-h-screen w-full transition-colors duration-300">
        <div className="toolhub-desktop-container max-w-7xl mx-auto px-4 pt-20 md:pt-24 pb-12">
          <div className="bg-gradient-to-b from-white/95 to-white/80 dark:from-gray-900/95 dark:to-gray-900/80 backdrop-blur-sm py-6 px-4 mb-8 rounded-2xl transition-colors duration-300">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => navigate("/pricetracker")}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                aria-label="Back to Price Tracker"
              >
                <ArrowLeft size={20} />
                <span className="text-sm font-medium">Back</span>
              </button>
              <div className="flex-1" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-center text-gray-900 dark:text-white tracking-tight drop-shadow-sm">
              Price Tracker Dashboard - Monitor Your Products
            </h1>
            <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-300">
              View real-time price changes and analytics for all your tracked
              products. Manage price drops and price history across popular
              ecommerce stores.
            </p>
          </div>

          {data.body.length === 0 ? (
            <div className="glass-card border border-gray-200 dark:border-gray-700 rounded-2xl p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 mx-auto mb-4 flex items-center justify-center text-3xl">
                📦
              </div>
              <p className="text-gray-600 dark:text-gray-300 text-lg">
                No products tracked yet
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                Start by adding a product from the Price Tracker
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6">
              {data.body.map((product: Product) => (
                <div
                  key={product.productId + product.targetPrice}
                  className="glass-card border border-gray-200 dark:border-gray-700 rounded-2xl p-5 flex flex-col h-full relative hover:shadow-lg transition-all duration-300 group"
                >
                  {/* Platform Badge & Menu */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                        <img
                          src={
                            getPlatformKey(product.productId) === "amazon"
                              ? amazonIcon
                              : getPlatformKey(product.productId) === "flipkart"
                              ? flipkartIcon
                              : undefined
                          }
                          alt="platform"
                          className={`w-4 h-4 ${
                            getPlatformKey(product.productId) === "amazon"
                              ? "dark:invert"
                              : ""
                          }`}
                        />
                      </div>
                      <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                        {platformLabels[getPlatformKey(product.productId)] || "Product"}
                      </span>
                    </div>

                    <div className="relative">
                      <button
                        onClick={() =>
                          setOpenMenuId(
                            openMenuId ===
                              product.productId + product.targetPrice
                              ? null
                              : product.productId + product.targetPrice
                          )
                        }
                        className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        aria-label="Product menu"
                      >
                        ⋮
                      </button>

                      {openMenuId ===
                        product.productId + product.targetPrice && (
                        <div className="absolute right-0 mt-2 w-32 glass-card border border-gray-200 dark:border-gray-700 shadow-lg rounded-xl z-20 overflow-hidden">
                          <button
                            onClick={() => {
                              handleDelete(
                                product.productId,
                                product.targetPrice
                              );
                              setOpenMenuId(null);
                            }}
                            className="block w-full text-left px-4 py-2.5 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 transition-colors duration-200"
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Product Image */}
                  <div className="relative mb-4 -mx-5 -mt-5 mb-4 px-5 overflow-hidden rounded-lg">
                    <img
                      src={product.productImageUrl}
                      alt={product.productTitle}
                      className="w-full h-40 object-contain bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 rounded-lg transition-all duration-300 dark:brightness-90"
                    />
                  </div>

                  {/* Product Title */}
                  <a
                    href={product?.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <h3 className="font-semibold text-base mb-3 text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 line-clamp-2">
                      {product.productTitle}
                    </h3>
                  </a>

                  {/* Price & Action Section */}
                  <div className="mt-auto pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="mb-4">
                      <p className="text-xs text-gray-600 dark:text-gray-400 font-medium mb-1">
                        Target Price
                      </p>
                      <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                        {formatINR(product.targetPrice)}
                      </p>
                    </div>

                    <button
                      onClick={() => setShowChartFor(product)}
                      className="w-full py-2.5 rounded-lg bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/30 dark:to-purple-900/30 text-blue-600 dark:text-blue-400 font-medium text-sm hover:shadow-md transition-all duration-200 border border-blue-200 dark:border-blue-800"
                    >
                      📊 View Price History
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Price Chart Modal */}
      {showChartFor && (
        <div className="fixed inset-0 bg-black/40 dark:bg-black/60 flex items-center justify-center z-50 transition-colors duration-300 p-4">
          <div className="glass-card border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl w-full max-w-2xl p-6 relative transition-colors duration-300 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowChartFor(null)}
              className="absolute top-4 right-4 p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors z-10"
              aria-label="Close"
            >
              ✕
            </button>

            <h2 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white pr-8">
              {showChartFor.productTitle}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              Price History
            </p>

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

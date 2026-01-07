const BASE_URL = import.meta.env.VITE_BASE_BACKEND_URL;

export const ProductService = {
  addProduct: (productUrl: string, targetPrice: string) => {
    return {
      url: `${BASE_URL}/v2/save-product`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify({
          productUrl: productUrl,
          targetPrice: targetPrice,
        }),
      },
    };
  },

  getProduct: () => {
    return {
      url: `${BASE_URL}/v2/products`,
      options: {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
      },
    };
  },

  deleteProduct: (productId: string, targetPrice: string) => {
    return {
      url: `${BASE_URL}/v2/delete`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify({
          productId: productId,
          targetPrice: targetPrice,
        }),
      },
    };
  },

  getPriceHistory: (productId: string) => {
    return {
      url: `${BASE_URL}/v2/pricehistory`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify({ productId }),
      },
    };
  },
};

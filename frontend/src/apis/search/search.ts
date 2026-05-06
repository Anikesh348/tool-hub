const BASE_URL = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");

export interface Product {
  title: string;
  product_url: string;
  image_url: string;
  price: string;
}

export type SearchPlatform =
  | "amazon"
  | "flipkart"
  | "myntra"
  | "nykaa"
  | "ajio"
  | "tatacliq"
  | "croma"
  | "meesho"
  | "shopsy"
  | "snapdeal"
  | "firstcry"
  | "bigbasket"
  | "reliancedigital"
  | "vijaysales"
  | "jiomart";

export const SearchService = {
  search: (query: string, platform: SearchPlatform) => {
    const encodedQuery = encodeURIComponent(query);
    return {
      url: `${BASE_URL}/v2/search?query=${encodedQuery}&platform=${platform}`,
      options: {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
    };
  },
};

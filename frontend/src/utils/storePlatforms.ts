import type { SearchPlatform } from "../apis/search/search";

export interface PlatformMeta {
  id: SearchPlatform;
  label: string;
  letter: string;
  badgeClass: string;
  hostPatterns: string[];
}

// Colors are chosen to loosely echo each store's real brand color, used for the
// small letter-badge shown on search results, dashboard cards, and the
// paste-link "detected store" indicator.
export const PLATFORMS: PlatformMeta[] = [
  { id: "amazon", label: "Amazon", letter: "a", badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30", hostPatterns: ["amazon."] },
  { id: "flipkart", label: "Flipkart", letter: "F", badgeClass: "bg-blue-500/15 text-blue-400 border-blue-500/30", hostPatterns: ["flipkart."] },
  { id: "myntra", label: "Myntra", letter: "M", badgeClass: "bg-pink-500/15 text-pink-400 border-pink-500/30", hostPatterns: ["myntra."] },
  { id: "nykaa", label: "Nykaa", letter: "N", badgeClass: "bg-rose-500/15 text-rose-400 border-rose-500/30", hostPatterns: ["nykaa."] },
  { id: "ajio", label: "Ajio", letter: "A", badgeClass: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30", hostPatterns: ["ajio."] },
  { id: "tatacliq", label: "Tata CLiQ", letter: "T", badgeClass: "bg-red-500/15 text-red-400 border-red-500/30", hostPatterns: ["tatacliq."] },
  { id: "croma", label: "Croma", letter: "C", badgeClass: "bg-teal-500/15 text-teal-400 border-teal-500/30", hostPatterns: ["croma."] },
  { id: "meesho", label: "Meesho", letter: "m", badgeClass: "bg-purple-500/15 text-purple-400 border-purple-500/30", hostPatterns: ["meesho."] },
  { id: "shopsy", label: "Shopsy", letter: "S", badgeClass: "bg-blue-500/15 text-blue-400 border-blue-500/30", hostPatterns: ["shopsy."] },
  { id: "snapdeal", label: "Snapdeal", letter: "S", badgeClass: "bg-red-500/15 text-red-400 border-red-500/30", hostPatterns: ["snapdeal."] },
  { id: "firstcry", label: "FirstCry", letter: "F", badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30", hostPatterns: ["firstcry."] },
  { id: "bigbasket", label: "BigBasket", letter: "B", badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", hostPatterns: ["bigbasket."] },
  { id: "reliancedigital", label: "Reliance Digital", letter: "R", badgeClass: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30", hostPatterns: ["reliancedigital."] },
  { id: "vijaysales", label: "Vijay Sales", letter: "V", badgeClass: "bg-rose-500/15 text-rose-400 border-rose-500/30", hostPatterns: ["vijaysales."] },
  { id: "jiomart", label: "JioMart", letter: "J", badgeClass: "bg-purple-500/15 text-purple-400 border-purple-500/30", hostPatterns: ["jiomart."] },
];

export const PLATFORM_BY_ID: Record<string, PlatformMeta> = Object.fromEntries(
  PLATFORMS.map((platform) => [platform.id, platform])
);

// The 8 stores the "paste a link" flow documents as supported (matches the
// backend's product-id extraction), used for "search all stores at once".
export const PRIMARY_SEARCH_PLATFORMS: SearchPlatform[] = [
  "amazon",
  "flipkart",
  "myntra",
  "nykaa",
  "ajio",
  "tatacliq",
  "croma",
  "meesho",
];

export function platformMetaForId(platformId: string): PlatformMeta {
  return (
    PLATFORM_BY_ID[platformId] || {
      id: platformId as SearchPlatform,
      label: platformId ? platformId[0].toUpperCase() + platformId.slice(1) : "Store",
      letter: platformId ? platformId[0].toUpperCase() : "?",
      badgeClass: "bg-slate-500/15 text-slate-400 border-slate-500/30",
      hostPatterns: [],
    }
  );
}

// Real, deterministic detection from the URL itself — no network call, no
// fabricated product data. Used by the paste-link tab to show which store a
// pasted URL belongs to before it's ever submitted.
export function detectPlatformFromUrl(url: string): PlatformMeta | null {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const platform of PLATFORMS) {
    if (platform.hostPatterns.some((pattern) => host.includes(pattern))) return platform;
  }
  return null;
}

export function platformIdFromProductId(productId: string): string {
  return productId.split("_")[0] || "";
}

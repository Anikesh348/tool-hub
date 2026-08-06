import { refreshAccessToken } from "../auth/authSession";

const BASE_URL = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");
const CLIENT_CACHE_MS = 10 * 60 * 1000;
const itemResponseCache = new Map<string, { expiresAt: number; value: BuzzWatchResponse }>();

export type BuzzWatchMode = "recent" | "year";
export type BuzzWatchMediaType = "all" | "movie" | "series";

export interface BuzzWatchGenre {
  key: string;
  name: string;
}

export interface BuzzWatchProvider {
  providerId?: number;
  name: string;
  logoUrl?: string;
  count?: number;
}

export interface BuzzWatchItem {
  itemId: string;
  tmdbId: number;
  imdbId?: string;
  title: string;
  mediaType: "movie" | "series";
  overview?: string;
  posterUrl?: string;
  backdropUrl?: string;
  releaseDate?: string;
  releasePeriod?: string;
  year?: string;
  genres: string[];
  genreKeys: string[];
  tmdbRating?: number;
  tmdbVoteCount?: number;
  rtScore?: number;
  imdbRating?: number;
  popularity?: number;
  buzzScore?: number;
  buzzConfidence?: "early" | "medium" | "high";
  buzzBreakdown?: {
    quality: number;
    audience: number;
    momentum: number;
    freshness: number;
    availability: number;
  };
  buzzReasons?: string[];
  matchScore?: number;
  recommendationScore?: number;
  recommendationLabel?: string;
  recommendationReasons?: string[];
  matchedGenreKeys?: string[];
  providers?: BuzzWatchProvider[];
  watchRegion?: string;
  availabilitySource?: string;
  releaseContext?: string;
  originalReleaseDate?: string;
  latestSeasonNumber?: number;
  creditCharacters?: string[];
  nudityAdvisory?: {
    severity: "UNKNOWN" | "NONE" | "MILD" | "MODERATE" | "SEVERE";
    totalVotes: number;
    severeVotes: number;
    score: number;
    isSteamy: boolean;
  };
  source?: string;
  externalUrl?: string;
}

export interface BuzzWatchYear {
  value: string;
  label: string;
  count: number;
}

export interface BuzzWatchResponse {
  genres: BuzzWatchGenre[];
  mode: BuzzWatchMode;
  year?: string | null;
  mediaType: BuzzWatchMediaType;
  items: BuzzWatchItem[];
  recent: BuzzWatchItem[];
  insights?: {
    windowDays: number;
    windowStart?: string;
    windowEnd?: string;
    watchRegion: string;
    totalTitles: number;
    movieCount: number;
    seriesCount: number;
    averageBuzz: number;
    highConfidenceTitles: number;
    providerCounts: BuzzWatchProvider[];
    topGenres: Array<{ name: string; count: number }>;
    methodology: string;
    availabilitySource: string;
  } | null;
  years: BuzzWatchYear[];
  stats: {
    totalMatches: number;
    shown: number;
    recent: number;
    rated: number;
    withRottenTomatoes: number;
    providers?: number;
    averageBuzz?: number;
  };
  lastUpdatedAt?: string;
  ratingProvider?: string;
  cache?: {
    hit: boolean;
    ttlHours: number;
    scope: string;
  };
}

export interface BuzzWatchPreference {
  exists: boolean;
  genreKeys: string[];
  genres: BuzzWatchGenre[];
  createdAt?: string;
  updatedAt?: string;
}

export interface BuzzWatchMovieHubAccess {
  hasAccess: boolean;
  status: "NOT_REQUESTED" | "PENDING" | "APPROVED" | "REJECTED" | "ADMIN_BYPASS";
  isAdmin?: boolean;
}

export interface BuzzWatchRequestResponse {
  message: string;
  requestId: string;
  status: "PENDING" | "APPROVED" | "DOWNLOADED";
  title: string;
  mediaType: "MOVIES" | "SHOWS";
  season?: number[];
  autoApproved?: boolean;
  notification?: string;
}

export interface BuzzWatchPerson {
  personId: number;
  name: string;
  profileUrl?: string;
  knownFor: string[];
  popularity: number;
}

export interface BuzzWatchPeopleResponse {
  query: string;
  people: BuzzWatchPerson[];
  source: string;
}

export interface BuzzWatchPersonCreditsResponse {
  personId: number;
  personName: string;
  mediaType: BuzzWatchMediaType;
  items: BuzzWatchItem[];
  total: number;
  source: string;
  cache: {
    hit: boolean;
    ttlHours: number;
  };
}

export interface BuzzWatchTitleDetails {
  itemId: string;
  tmdbId: number;
  imdbId?: string;
  title: string;
  mediaType: "movie" | "series";
  tagline?: string;
  overview?: string;
  posterUrl?: string;
  backdropUrl?: string;
  releaseDate?: string;
  genres: string[];
  rating: number;
  voteCount: number;
  runtimeMinutes?: number;
  status?: string;
  certification?: string;
  numberOfSeasons?: number;
  creators: string[];
  cast: Array<{
    personId: number;
    name: string;
    character?: string;
    profileUrl?: string;
  }>;
  parentsGuide: Array<{
    category: string;
    categoryId: string;
    severity: "UNKNOWN" | "NONE" | "MILD" | "MODERATE" | "SEVERE";
    severityLabel: string;
    totalVotes: number;
  }>;
  parentsGuideSource: string;
  cache: {
    hit: boolean;
    ttlHours: number;
  };
}

const requestJson = async <T>(url: string, options?: RequestInit): Promise<T> => {
  let response = await fetch(url, {
    ...(options || {}),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  if (response.status === 401 && (await refreshAccessToken())) {
    response = await fetch(url, {
      ...(options || {}),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },
    });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || response.statusText || "Request failed");
  }
  return body?.response as T;
};

export const BuzzWatchService = {
  getItems: (params: {
    mode: BuzzWatchMode;
    year: string;
    mediaType: BuzzWatchMediaType;
  }, force = false) => {
    const search = new URLSearchParams();
    search.set("mode", params.mode);
    search.set("year", params.year);
    search.set("mediaType", params.mediaType);
    search.set("limit", "120");
    const cacheKey = search.toString();
    const cached = itemResponseCache.get(cacheKey);
    if (!force && cached && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.value);
    }
    return requestJson<BuzzWatchResponse>(`${BASE_URL}/v2/buzzwatch/items?${cacheKey}`).then((value) => {
      itemResponseCache.set(cacheKey, { value, expiresAt: Date.now() + CLIENT_CACHE_MS });
      return value;
    });
  },
  getPreference: () => {
    return requestJson<BuzzWatchPreference>(`${BASE_URL}/v2/buzzwatch/preference`);
  },
  savePreference: (genreKeys: string[]) => {
    return requestJson<BuzzWatchPreference>(`${BASE_URL}/v2/buzzwatch/preference`, {
      method: "PUT",
      body: JSON.stringify({ genreKeys }),
    }).then((value) => {
      itemResponseCache.clear();
      return value;
    });
  },
  getMovieHubAccess: () => {
    return requestJson<BuzzWatchMovieHubAccess>(`${BASE_URL}/v2/moviehub/access/me`);
  },
  searchPeople: (query: string) => {
    const search = new URLSearchParams({ query: query.trim() });
    return requestJson<BuzzWatchPeopleResponse>(`${BASE_URL}/v2/buzzwatch/people?${search}`);
  },
  getPersonCredits: (personId: number, mediaType: BuzzWatchMediaType) => {
    const search = new URLSearchParams({ mediaType });
    return requestJson<BuzzWatchPersonCreditsResponse>(
      `${BASE_URL}/v2/buzzwatch/people/${personId}/credits?${search}`,
    );
  },
  getTitleDetails: (itemId: string) => {
    const search = new URLSearchParams({ itemId });
    return requestJson<BuzzWatchTitleDetails>(
      `${BASE_URL}/v2/buzzwatch/details?${search}`,
    );
  },
  requestTitle: (itemId: string) => {
    return requestJson<BuzzWatchRequestResponse>(`${BASE_URL}/v2/buzzwatch/request`, {
      method: "POST",
      body: JSON.stringify({ itemId }),
    });
  },
};

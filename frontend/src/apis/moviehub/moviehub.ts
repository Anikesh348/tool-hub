import { getBearerAuthHeader } from "../auth/tokenStorage";

const BASE_URL = import.meta.env.VITE_BASE_BACKEND_URL;

export type MovieHubMediaType = "MOVIES" | "SHOWS";
export type MovieHubQuality = "any" | "720p" | "1080p" | "4k";
export type MovieHubAccessState = "NOT_REQUESTED" | "PENDING" | "APPROVED" | "REJECTED" | "ADMIN_BYPASS";

export interface MovieHubSearchResult {
  title: string;
  year?: number;
  overview?: string;
  poster?: string;
  mediaType: MovieHubMediaType;
  tmdbId?: number;
  tvdbId?: number;
  imdbId?: string;
  seasonOptions?: number[];
}

export interface MovieHubRequest {
  requestId: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  title: string;
  mediaType: MovieHubMediaType;
  tmdbId?: number;
  tvdbId?: number;
  imdbId?: string;
  qualityProfileId: MovieHubQuality;
  season?: number[];
  status: "PENDING" | "APPROVED" | "DOWNLOADED";
  createdAt?: string;
  updatedAt?: string;
  approvedAt?: string;
  downloadedAt?: string;
}

export interface MovieHubAvailableMedia {
  title: string;
  year?: number;
  overview?: string;
  poster?: string;
  mediaType: MovieHubMediaType;
  radarrId?: number;
  sonarrId?: number;
  path?: string;
  qualityProfileId?: number;
  added?: string;
  imdbId?: string;
  tmdbId?: number;
  tvdbId?: number;
  episodeFileCount?: number;
  episodeCount?: number;
  totalEpisodeCount?: number;
  percentOfEpisodes?: number;
  availableSeasons?: number[];
}

export type MovieHubDownloadScope = "mine" | "all";

export interface MovieHubDownloadHandlingState {
  statusKnown?: boolean;
  paused?: boolean;
  partiallyPaused?: boolean;
  radarrEnabled?: boolean | null;
  sonarrEnabled?: boolean | null;
}

export interface MovieHubDownloadItem {
  queueItemId?: number | string;
  downloadId?: string;
  title: string;
  mediaType: MovieHubMediaType;
  status?: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  protocol?: string;
  downloadClient?: string;
  indexer?: string;
  timeleft?: string;
  added?: string;
  estimatedCompletionTime?: string;
  size?: number;
  sizeleft?: number;
  progressPercent?: number;
  seasonNumbers?: number[];
  episodeCount?: number;
}

export interface MovieHubCompletedDownloadItem {
  requestId: string;
  title: string;
  mediaType: MovieHubMediaType;
  qualityProfileId?: MovieHubQuality;
  season?: number[];
  status?: string;
  createdAt?: string;
  approvedAt?: string;
  downloadedAt?: string;
  requestedBy?: {
    userId?: string;
    userName?: string;
    userEmail?: string;
  };
}

export interface MovieHubAccessStatus {
  hasAccess: boolean;
  isAdmin?: boolean;
  status: MovieHubAccessState;
  exists?: boolean;
  email?: string;
  movieHubUserName?: string;
  requestId?: string;
  requestedAt?: string;
  approvedAt?: string;
  showTemporaryPasswordNotice?: boolean;
}

export interface MovieHubAccessRequest {
  requestId: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  movieHubUserName: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt?: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface MovieHubAccessUser {
  mappingId: string;
  requestId?: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  movieHubUserName: string;
  movieHubUserNameLower?: string;
  jellyfinUserId?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  active?: boolean;
  roleTag?: "ADMIN" | "USER";
  isAdmin?: boolean;
}

export interface MovieHubYtRequestFormat {
  quality: string;
  ext?: string;
}

export interface MovieHubYtFormatItem {
  label?: string;
  quality: string;
  height?: number;
  ext?: string;
  audio_combined?: boolean;
  request_format?: MovieHubYtRequestFormat;
}

export interface MovieHubYtFormatsResponse {
  id?: string;
  title?: string;
  duration?: number;
  webpage_url?: string;
  thumbnail?: string;
  uploader?: string;
  extractor?: string;
  formats: MovieHubYtFormatItem[];
}

export interface MovieHubYtDownloadRequest {
  requestId: string;
  videoId: string;
  userId?: string;
  url?: string;
  title?: string;
  filename?: string;
  download_path?: string;
  format?: MovieHubYtRequestFormat;
  status: string;
  userEmail?: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  downloadedAt?: string;
}

export interface MovieHubYtLibraryItem {
  Id: string;
  Name: string;
  Path?: string;
  SortName?: string;
  ChildCount?: number;
  MediaSourceCount?: number;
  Type?: string;
  IsFolder?: boolean;
  RunTimeTicks?: number;
  Container?: string;
  LocationType?: string;
  MediaType?: string;
}

export const MovieHubService = {
  search: (term: string, mediaType: MovieHubMediaType) => {
    const encodedTerm = encodeURIComponent(term);
    return {
      url: `${BASE_URL}/v2/moviehub/search?term=${encodedTerm}&mediaType=${mediaType}`,
      options: {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  createRequest: (payload: {
    title: string;
    mediaType: MovieHubMediaType;
    tmdbId?: number;
    tvdbId?: number;
    imdbId?: string;
    qualityProfileId: MovieHubQuality;
    season?: number[];
  }) => {
    return {
      url: `${BASE_URL}/v2/moviehub/requests`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
        body: JSON.stringify(payload),
      },
    };
  },

  getMyRequests: () => {
    return {
      url: `${BASE_URL}/v2/moviehub/requests`,
      options: {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  getAvailableMedia: (mediaType: MovieHubMediaType) => {
    return {
      url: `${BASE_URL}/v2/moviehub/available?mediaType=${mediaType}`,
      options: {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  deleteAvailableMedia: (payload: {
    id: number;
    mediaType: MovieHubMediaType;
    deleteFiles?: boolean;
    addImportExclusion?: boolean;
  }) => {
    return {
      url: `${BASE_URL}/v2/admin/moviehub/available/delete`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
        body: JSON.stringify(payload),
      },
    };
  },

  getDownloadQueue: (scope: MovieHubDownloadScope = "mine") => {
    return {
      url: `${BASE_URL}/v2/moviehub/downloads?scope=${scope}`,
      options: {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  pauseDownloads: () => {
    return {
      url: `${BASE_URL}/v2/admin/moviehub/downloads/pause`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  resumeDownloads: () => {
    return {
      url: `${BASE_URL}/v2/admin/moviehub/downloads/resume`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  deleteDownload: (payload: {
    queueItemId: number;
    mediaType: MovieHubMediaType;
    removeFromClient?: boolean;
    blocklist?: boolean;
    skipRedownload?: boolean;
    changeCategory?: boolean;
  }) => {
    return {
      url: `${BASE_URL}/v2/admin/moviehub/downloads/delete`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
        body: JSON.stringify(payload),
      },
    };
  },

  getCompletedDownloads: (scope: MovieHubDownloadScope = "mine") => {
    return {
      url: `${BASE_URL}/v2/moviehub/completedDownloads?scope=${scope}`,
      options: {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  getAllRequests: () => {
    return {
      url: `${BASE_URL}/v2/admin/moviehub/requests`,
      options: {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  approveRequest: (requestId: string) => {
    return {
      url: `${BASE_URL}/v2/admin/moviehub/requests/${requestId}/approve`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  deleteRequest: (requestId: string) => {
    return {
      url: `${BASE_URL}/v2/moviehub/requests/${requestId}/delete`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  getAccessStatus: () => {
    return {
      url: `${BASE_URL}/v2/moviehub/access/me`,
      options: {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  createAccessRequest: (movieHubUserName: string) => {
    return {
      url: `${BASE_URL}/v2/moviehub/access/request`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
        body: JSON.stringify({ movieHubUserName }),
      },
    };
  },

  getAccessUserMapping: () => {
    return {
      url: `${BASE_URL}/v2/moviehub/access/user`,
      options: {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  getAccessRequests: (status = "PENDING") => {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return {
      url: `${BASE_URL}/v2/admin/moviehub/access/requests${query}`,
      options: {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  approveAccessRequest: (requestId: string) => {
    return {
      url: `${BASE_URL}/v2/admin/moviehub/access/requests/${requestId}/approve`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  rejectAccessRequest: (requestId: string) => {
    return {
      url: `${BASE_URL}/v2/admin/moviehub/access/requests/${requestId}/reject`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  getAccessUsers: () => {
    return {
      url: `${BASE_URL}/v2/admin/moviehub/access/users`,
      options: {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  deleteAccessUser: (mappingId: string) => {
    return {
      url: `${BASE_URL}/v2/admin/moviehub/access/users/${mappingId}`,
      options: {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  resendTemporaryPassword: () => {
    return {
      url: `${BASE_URL}/v2/moviehub/access/resend-password`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  confirmPasswordReset: () => {
    return {
      url: `${BASE_URL}/v2/moviehub/access/confirm-password-reset`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  getYtFormats: (urlValue: string) => {
    return {
      url: `${BASE_URL}/v2/yt/formats`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
        body: JSON.stringify({
          url: urlValue,
        }),
      },
    };
  },

  addYtDownload: (payload: {
    videoId: string;
    format: MovieHubYtRequestFormat;
    url?: string;
    title?: string;
    filename?: string;
    download_path?: string;
    isSong?: boolean;
  }) => {
    return {
      url: `${BASE_URL}/v2/admin/yt/download/add`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
        body: JSON.stringify(payload),
      },
    };
  },

  startYtDownload: () => {
    return {
      url: `${BASE_URL}/v2/admin/yt/download/start`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  getYtDownloadRequests: () => {
    return {
      url: `${BASE_URL}/v2/admin/yt/download/requests`,
      options: {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  deleteYtDownloadRequest: (requestId: string) => {
    return {
      url: `${BASE_URL}/v2/admin/yt/download/requests/${encodeURIComponent(requestId)}`,
      options: {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  getYtDownloadStatus: (videoId: string) => {
    return {
      url: `${BASE_URL}/v2/admin/yt/download/status/${encodeURIComponent(videoId)}`,
      options: {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  getYtDownloadStatusStream: (videoId: string) => {
    return {
      url: `${BASE_URL}/v2/admin/yt/download/status/stream/${encodeURIComponent(videoId)}`,
      options: {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  getYtLibraryItems: (payload?: {
    parentId?: string;
    startIndex?: number;
    limit?: number;
  }) => {
    const query = new URLSearchParams();
    if (payload?.parentId?.trim()) {
      query.set("parentId", payload.parentId.trim());
    }
    if (typeof payload?.startIndex === "number" && payload.startIndex >= 0) {
      query.set("startIndex", String(payload.startIndex));
    }
    if (typeof payload?.limit === "number" && payload.limit > 0) {
      query.set("limit", String(payload.limit));
    }
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return {
      url: `${BASE_URL}/v2/admin/yt/library/items${suffix}`,
      options: {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },

  deleteYtLibraryItem: (itemId: string) => {
    return {
      url: `${BASE_URL}/v2/admin/yt/library/items/${encodeURIComponent(itemId)}`,
      options: {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
      },
    };
  },
};

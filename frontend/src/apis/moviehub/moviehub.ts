const BASE_URL = import.meta.env.VITE_BASE_BACKEND_URL;

export type MovieHubMediaType = "MOVIES" | "SHOWS";
export type MovieHubQuality = "any" | "720p" | "1080p";
export type MovieHubAccessState = "NOT_REQUESTED" | "PENDING" | "APPROVED" | "REJECTED" | "ADMIN_BYPASS";

export interface MovieHubSearchResult {
  title: string;
  year?: number;
  overview?: string;
  poster?: string;
  mediaType: MovieHubMediaType;
  seasonOptions?: number[];
}

export interface MovieHubRequest {
  requestId: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  title: string;
  mediaType: MovieHubMediaType;
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
      },
    };
  },

  createRequest: (payload: {
    title: string;
    mediaType: MovieHubMediaType;
    qualityProfileId: MovieHubQuality;
    season?: number[];
  }) => {
    return {
      url: `${BASE_URL}/v2/moviehub/requests`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
  }) => {
    return {
      url: `${BASE_URL}/v2/admin/yt/download/add`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
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
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
      },
    };
  },
};

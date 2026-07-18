import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useApiFetcher } from "../hooks/useApiFetcher";
import {
  MovieHubAccessRequest,
  MovieHubAccessStatus,
  MovieHubAccessUser,
  MovieHubAvailableMedia,
  MovieHubCompletedDownloadItem,
  MovieHubDownloadHandlingState,
  MovieHubDownloadItem,
  MovieHubDownloadScope,
  MovieHubQuality,
  MovieHubRequest,
  MovieHubSearchResult,
  MovieHubService,
  MovieHubYtDownloadRequest,
  MovieHubYtFormatsResponse,
  MovieHubYtLibraryItem,
  MovieHubYtRequestFormat,
} from "../apis/moviehub/moviehub";
import { Loader } from "./Loader";
import { useNotification } from "../context/NotificationContext";
import { MovieHubSection, SectionConfig } from "./moviehub/types";
import { MovieHubNav } from "./moviehub/MovieHubNav";
import { MovieHubRequestSection } from "./moviehub/MovieHubRequestSection";
import { MovieHubStatusSection } from "./moviehub/MovieHubStatusSection";
import { MovieHubAdminSection } from "./moviehub/MovieHubAdminSection";
import { MovieHubAvailableSection } from "./moviehub/MovieHubAvailableSection";
import { MovieHubDownloadingSection } from "./moviehub/MovieHubDownloadingSection";
import { MovieHubAccessGateSection } from "./moviehub/MovieHubAccessGateSection";
import { MovieHubOpenSection } from "./moviehub/MovieHubOpenSection";
import { MovieHubAccessAdminSection } from "./moviehub/MovieHubAccessAdminSection";
import { MovieHubUsersAdminSection } from "./moviehub/MovieHubUsersAdminSection";
import {
  MovieHubYtAdminSection,
} from "./moviehub/MovieHubYtAdminSection";
import { CinePilotLauncher } from "./CineBotLauncher";
import { CinePilotChat } from "./CineBot";

const DEFAULT_QUALITY: MovieHubQuality = "any";
const MOVIEHUB_PORTAL_URL = "https://openmovies.hostingfrompurva.xyz";

const formatDateTime = (value?: string) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

const parseSsePayload = (rawEvent: string): string | null => {
  const dataLines = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  const payload = dataLines.join("\n").trim();
  return payload || null;
};

const MOVIEHUB_SECTION_ROUTES: Record<MovieHubSection, string> = {
  available: "/moviehub",
  open: "/moviehub/watch",
  request: "/moviehub/browse",
  status: "/moviehub/my-list",
  downloading: "/moviehub/downloads",
  admin_approve: "/moviehub/admin/approvals",
  admin_yt_download: "/moviehub/admin/youtube",
  admin_access: "/moviehub/admin/access",
  admin_users: "/moviehub/admin/members",
};

const MOVIEHUB_ADMIN_SECTIONS = new Set<MovieHubSection>([
  "admin_approve",
  "admin_yt_download",
  "admin_access",
  "admin_users",
]);

const getSectionFromPath = (pathname: string): MovieHubSection => {
  const match = Object.entries(MOVIEHUB_SECTION_ROUTES).find(
    ([, route]) => route === pathname,
  );
  return (match?.[0] as MovieHubSection | undefined) || "available";
};

export const MovieHub: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { authToken, isAuthLoading, user } = useAuth();
  const { addNotification } = useNotification();
  const isAdmin = user?.role === "ADMIN";
  const isChatPage = location.pathname.startsWith("/moviehub/chat");
  const toolHubSessionKey = useMemo(
    () => user?.userId || user?.email || authToken || "anonymous",
    [authToken, user?.email, user?.userId],
  );

  const [activeSection, setActiveSection] = useState<MovieHubSection>(() =>
    getSectionFromPath(location.pathname),
  );
  const [showCinePilot, setShowCinePilot] = useState(false);
  const [mediaType, setMediaType] = useState<"MOVIES" | "SHOWS">("MOVIES");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MovieHubSearchResult[]>([]);
  const [availableMediaType, setAvailableMediaType] = useState<
    "MOVIES" | "SHOWS"
  >("MOVIES");
  const [downloadScope, setDownloadScope] =
    useState<MovieHubDownloadScope>("mine");
  const [availableItems, setAvailableItems] = useState<
    MovieHubAvailableMedia[]
  >([]);
  const [downloadItems, setDownloadItems] = useState<MovieHubDownloadItem[]>(
    [],
  );
  const [completedDownloadItems, setCompletedDownloadItems] = useState<
    MovieHubCompletedDownloadItem[]
  >([]);
  const [downloadHandling, setDownloadHandling] =
    useState<MovieHubDownloadHandlingState | null>(null);
  const [requests, setRequests] = useState<MovieHubRequest[]>([]);
  const [adminRequests, setAdminRequests] = useState<MovieHubRequest[]>([]);
  const [qualityByResult, setQualityByResult] = useState<
    Record<string, MovieHubQuality>
  >({});
  const [seasonsByResult, setSeasonsByResult] = useState<
    Record<string, number[]>
  >({});
  const [activeRequestKey, setActiveRequestKey] = useState<string | null>(null);
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(
    null,
  );
  const [deletingRequestId, setDeletingRequestId] = useState<string | null>(
    null,
  );
  const [deletingAvailableMediaId, setDeletingAvailableMediaId] = useState<
    string | null
  >(null);
  const [playingMediaTitle, setPlayingMediaTitle] = useState<string | null>(
    null,
  );
  const [downloadControlLoading, setDownloadControlLoading] = useState(false);
  const [deletingQueueItemKey, setDeletingQueueItemKey] = useState<
    string | null
  >(null);
  const [approvingAccessRequestId, setApprovingAccessRequestId] = useState<
    string | null
  >(null);
  const [rejectingAccessRequestId, setRejectingAccessRequestId] = useState<
    string | null
  >(null);
  const [autoApproveRequestId, setAutoApproveRequestId] = useState<
    string | null
  >(null);
  const [accessStatus, setAccessStatus] = useState<MovieHubAccessStatus | null>(
    null,
  );
  const [accessRequests, setAccessRequests] = useState<MovieHubAccessRequest[]>(
    [],
  );
  const [accessUsers, setAccessUsers] = useState<MovieHubAccessUser[]>([]);
  const [requestedMovieHubUserName, setRequestedMovieHubUserName] =
    useState("");
  const [portalUserName, setPortalUserName] = useState("");
  const [deletingAccessUserMappingId, setDeletingAccessUserMappingId] =
    useState<string | null>(null);
  const [ytUrl, setYtUrl] = useState("");
  const [ytFilename, setYtFilename] = useState("");
  const [ytPassDownloadPath, setYtPassDownloadPath] = useState(false);
  const [ytDownloadPath, setYtDownloadPath] = useState("");
  const [ytIsSong, setYtIsSong] = useState(false);
  const [ytFormatsResponse, setYtFormatsResponse] =
    useState<MovieHubYtFormatsResponse | null>(null);
  const [selectedYtFormat, setSelectedYtFormat] =
    useState<MovieHubYtRequestFormat | null>(null);
  const [ytDownloadRequests, setYtDownloadRequests] = useState<
    MovieHubYtDownloadRequest[]
  >([]);
  const [ytStatusByVideoId, setYtStatusByVideoId] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [ytLibraryItems, setYtLibraryItems] = useState<MovieHubYtLibraryItem[]>(
    [],
  );
  const [deletingYtLibraryItemId, setDeletingYtLibraryItemId] = useState<
    string | null
  >(null);
  const [deletingYtRequestId, setDeletingYtRequestId] = useState<string | null>(
    null,
  );
  const [ytDownloadInProgress, setYtDownloadInProgress] = useState(false);
  const [ytDownloadError, setYtDownloadError] = useState<string | null>(null);

  useEffect(() => {
    setAccessStatus(null);
    setPortalUserName("");
  }, [toolHubSessionKey]);

  const {
    loading: accessStatusLoading,
    data: accessStatusData,
    fetchData: fetchAccessStatus,
  } = useApiFetcher();
  const {
    loading: createAccessRequestLoading,
    data: createAccessRequestData,
    fetchData: fetchCreateAccessRequest,
  } = useApiFetcher();
  const {
    loading: accessRequestsLoading,
    data: accessRequestsData,
    fetchData: fetchAccessRequests,
  } = useApiFetcher();
  const {
    loading: approveAccessLoading,
    data: approveAccessData,
    fetchData: fetchApproveAccessRequest,
  } = useApiFetcher();
  const {
    loading: rejectAccessLoading,
    data: rejectAccessData,
    fetchData: fetchRejectAccessRequest,
  } = useApiFetcher();
  const {
    loading: accessUsersLoading,
    data: accessUsersData,
    fetchData: fetchAccessUsers,
  } = useApiFetcher();
  const {
    loading: deleteAccessUserLoading,
    data: deleteAccessUserData,
    fetchData: fetchDeleteAccessUser,
  } = useApiFetcher();
  const {
    loading: resendPasswordLoading,
    data: resendPasswordData,
    fetchData: fetchResendPassword,
  } = useApiFetcher();
  const {
    loading: confirmPasswordResetLoading,
    data: confirmPasswordResetData,
    fetchData: fetchConfirmPasswordReset,
  } = useApiFetcher();
  const {
    loading: searchLoading,
    data: searchData,
    fetchData: fetchSearch,
  } = useApiFetcher();
  const {
    loading: createLoading,
    data: createData,
    fetchData: fetchCreateRequest,
  } = useApiFetcher();
  const {
    loading: requestsLoading,
    data: requestsData,
    fetchData: fetchMyRequests,
  } = useApiFetcher();
  const {
    loading: availableLoading,
    data: availableData,
    fetchData: fetchAvailableMedia,
  } = useApiFetcher();
  const {
    loading: deleteAvailableLoading,
    data: deleteAvailableData,
    fetchData: fetchDeleteAvailableMedia,
  } = useApiFetcher();
  const {
    loading: downloadsLoading,
    data: downloadsData,
    fetchData: fetchDownloadQueue,
  } = useApiFetcher();
  const {
    loading: pauseDownloadsLoading,
    data: pauseDownloadsData,
    fetchData: fetchPauseDownloads,
  } = useApiFetcher();
  const {
    loading: resumeDownloadsLoading,
    data: resumeDownloadsData,
    fetchData: fetchResumeDownloads,
  } = useApiFetcher();
  const {
    loading: deleteDownloadLoading,
    data: deleteDownloadData,
    fetchData: fetchDeleteDownload,
  } = useApiFetcher();
  const {
    data: playMediaData,
    fetchData: fetchPlayMedia,
  } = useApiFetcher();
  const {
    loading: completedDownloadsLoading,
    data: completedDownloadsData,
    fetchData: fetchCompletedDownloads,
  } = useApiFetcher();
  const {
    loading: adminRequestsLoading,
    data: adminRequestsData,
    fetchData: fetchAllRequests,
  } = useApiFetcher();
  const {
    loading: approveLoading,
    data: approveData,
    fetchData: fetchApproveRequest,
  } = useApiFetcher();
  const {
    loading: deleteLoading,
    data: deleteData,
    fetchData: fetchDeleteRequest,
  } = useApiFetcher();
  const {
    loading: ytFormatsLoading,
    data: ytFormatsData,
    fetchData: fetchYtFormats,
  } = useApiFetcher();
  const {
    loading: ytRequestsLoading,
    data: ytRequestsData,
    fetchData: fetchYtRequests,
  } = useApiFetcher();
  const {
    loading: ytLibraryLoading,
    data: ytLibraryData,
    fetchData: fetchYtLibraryItems,
  } = useApiFetcher();
  const {
    loading: deleteYtLibraryLoading,
    data: deleteYtLibraryData,
    fetchData: fetchDeleteYtLibraryItem,
  } = useApiFetcher();
  const {
    loading: deleteYtRequestLoading,
    data: deleteYtRequestData,
    fetchData: fetchDeleteYtRequest,
  } = useApiFetcher();

  const isBusy =
    accessStatusLoading ||
    createAccessRequestLoading ||
    accessRequestsLoading ||
    approveAccessLoading ||
    rejectAccessLoading ||
    accessUsersLoading ||
    deleteAccessUserLoading ||
    resendPasswordLoading ||
    confirmPasswordResetLoading ||
    searchLoading ||
    createLoading ||
    requestsLoading ||
    approveLoading ||
    deleteLoading ||
    deleteAvailableLoading ||
    pauseDownloadsLoading ||
    resumeDownloadsLoading ||
    deleteDownloadLoading ||
    ytRequestsLoading ||
    deleteYtRequestLoading ||
    deleteYtLibraryLoading ||
    availableLoading ||
    downloadsLoading ||
    completedDownloadsLoading;

  const isUnauthenticated = !isAuthLoading && !authToken;
  const hasMovieHubAccess =
    isAdmin || Boolean(accessStatus?.exists || accessStatus?.hasAccess);
  const pendingAdminRequestsCount = useMemo(
    () =>
      adminRequests.filter((request) => request.status === "PENDING").length,
    [adminRequests],
  );
  const pendingAccessRequestsCount = useMemo(
    () => accessRequests.length,
    [accessRequests],
  );

  const sectionConfig = useMemo(() => {
    const baseSectionConfig: SectionConfig[] = [
      {
        id: "available",
        label: "Home",
        compactLabel: "HM",
      },
      {
        id: "open",
        label: "Watch",
        compactLabel: "WT",
      },
      {
        id: "request",
        label: "Browse",
        compactLabel: "BR",
      },
      {
        id: "status",
        label: "My List",
        compactLabel: "ML",
      },
      {
        id: "downloading",
        label: "Downloads",
        compactLabel: "DL",
      },
    ];
    if (!isAdmin) return baseSectionConfig;
    return [
      ...baseSectionConfig,
      {
        id: "admin_approve" as MovieHubSection,
        label: "Approvals",
        compactLabel: "AP",
        adminOnly: true,
        badgeCount: pendingAdminRequestsCount,
      },
      {
        id: "admin_yt_download" as MovieHubSection,
        label: "YT",
        compactLabel: "YT",
        adminOnly: true,
      },
      {
        id: "admin_access" as MovieHubSection,
        label: "Access",
        compactLabel: "AC",
        adminOnly: true,
        badgeCount: pendingAccessRequestsCount,
      },
      {
        id: "admin_users" as MovieHubSection,
        label: "Members",
        compactLabel: "US",
        adminOnly: true,
      },
    ];
  }, [isAdmin, pendingAdminRequestsCount, pendingAccessRequestsCount]);

  useEffect(() => {
    if (isChatPage) return;
    const nextSection = getSectionFromPath(location.pathname);
    if (MOVIEHUB_ADMIN_SECTIONS.has(nextSection) && !isAdmin) {
      if (!isAuthLoading) {
        navigate("/moviehub", { replace: true });
      }
      return;
    }
    setActiveSection(nextSection);
  }, [
    isAdmin,
    isAuthLoading,
    isChatPage,
    location.pathname,
    navigate,
  ]);

  useEffect(() => {
    if (!playMediaData) return;
    if (playMediaData.status >= 200 && playMediaData.status < 300) {
      setActiveSection("open");
      navigate(MOVIEHUB_SECTION_ROUTES.open);
      addNotification(
        `Playing ${playMediaData.body?.response?.title || "your selection"}`,
        "success",
      );
    } else {
      addNotification(
        playMediaData.body?.error || "MovieHub could not start playback",
        "error",
      );
    }
    setPlayingMediaTitle(null);
  }, [playMediaData, addNotification, navigate]);

  useEffect(() => {
    if (isUnauthenticated) {
      navigate("/login", { state: { from: location.pathname } });
    }
  }, [isUnauthenticated, location.pathname, navigate]);

  const loadMyRequests = useCallback(() => {
    const { url, options } = MovieHubService.getMyRequests();
    fetchMyRequests(url, options);
  }, [fetchMyRequests]);

  const loadAccessStatus = useCallback(() => {
    const { url, options } = MovieHubService.getAccessUserMapping();
    fetchAccessStatus(url, options);
  }, [fetchAccessStatus]);

  const loadAccessRequests = useCallback(() => {
    if (!isAdmin) return;
    const { url, options } = MovieHubService.getAccessRequests("PENDING");
    fetchAccessRequests(url, options);
  }, [isAdmin, fetchAccessRequests]);

  const loadAllRequests = useCallback(() => {
    if (!isAdmin) return;
    const { url, options } = MovieHubService.getAllRequests();
    fetchAllRequests(url, options);
  }, [isAdmin, fetchAllRequests]);

  const loadAccessUsers = useCallback(() => {
    if (!isAdmin) return;
    const { url, options } = MovieHubService.getAccessUsers();
    fetchAccessUsers(url, options);
  }, [isAdmin, fetchAccessUsers]);

  const loadAvailableMedia = useCallback(
    (type: "MOVIES" | "SHOWS") => {
      const { url, options } = MovieHubService.getAvailableMedia(type);
      fetchAvailableMedia(url, options);
    },
    [fetchAvailableMedia],
  );

  const loadDownloadQueue = useCallback(
    (scope: MovieHubDownloadScope) => {
      const { url, options } = MovieHubService.getDownloadQueue(scope);
      fetchDownloadQueue(url, options);
    },
    [fetchDownloadQueue],
  );

  const loadYtDownloadRequests = useCallback(() => {
    if (!isAdmin) return;
    const { url, options } = MovieHubService.getYtDownloadRequests();
    fetchYtRequests(url, options);
  }, [isAdmin, fetchYtRequests]);

  const loadYtLibraryItems = useCallback(() => {
    if (!isAdmin) return;
    const { url, options } = MovieHubService.getYtLibraryItems({
      startIndex: 0,
      limit: 100,
    });
    fetchYtLibraryItems(url, options);
  }, [isAdmin, fetchYtLibraryItems]);

  const streamDownloadingStatus = useCallback(async (videoId: string, signal: AbortSignal) => {
    while (!signal.aborted) {
      const { url, options } = MovieHubService.getYtDownloadStatusStream(videoId);
      try {
        const response = await fetch(url, {
          ...options,
          cache: "no-store",
          signal,
        });
        if (response.ok && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (!signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
            let separatorIndex = buffer.indexOf("\n\n");
            while (separatorIndex !== -1) {
              const rawEvent = buffer.slice(0, separatorIndex);
              buffer = buffer.slice(separatorIndex + 2);

              const payload = parseSsePayload(rawEvent);
              if (payload) {
                try {
                  const parsed = JSON.parse(payload);
                  if (parsed && typeof parsed === "object") {
                    setYtStatusByVideoId((prev) => ({
                      ...prev,
                      [videoId]: parsed as Record<string, unknown>,
                    }));
                  }
                } catch {
                  // ignore non-json SSE messages
                }
              }

              separatorIndex = buffer.indexOf("\n\n");
            }
          }
        }
      } catch {
        // stream errors are tolerated
      }
      if (signal.aborted) break;
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
  }, []);

  const loadCompletedDownloads = useCallback(
    (scope: MovieHubDownloadScope) => {
      const { url, options } = MovieHubService.getCompletedDownloads(scope);
      fetchCompletedDownloads(url, options);
    },
    [fetchCompletedDownloads],
  );

  useEffect(() => {
    if (!authToken || isAuthLoading) return;
    loadAccessStatus();
    if (isAdmin) {
      loadMyRequests();
      loadAllRequests();
      loadAccessRequests();
      loadAccessUsers();
    }
  }, [
    authToken,
    isAuthLoading,
    isAdmin,
    loadMyRequests,
    loadAllRequests,
    loadAccessStatus,
    loadAccessRequests,
    loadAccessUsers,
  ]);

  useEffect(() => {
    if (!authToken || isAuthLoading || isAdmin) return;
    if (hasMovieHubAccess) {
      loadMyRequests();
    }
  }, [authToken, isAuthLoading, isAdmin, hasMovieHubAccess, loadMyRequests]);

  useEffect(() => {
    if (!accessStatusData) return;
    if (accessStatusData.status >= 200 && accessStatusData.status < 300) {
      const response = accessStatusData.body?.response || {};
      if (response.userId && user?.userId && response.userId !== user.userId) {
        return;
      }
      const resolvedStatus =
        response.status || (response.exists ? "APPROVED" : "NOT_REQUESTED");
      const status: MovieHubAccessStatus = {
        userId: response.userId || user?.userId || "",
        hasAccess: Boolean(response.exists),
        exists: Boolean(response.exists),
        status: resolvedStatus,
        email: response.email || "",
        movieHubUserName: response.movieHubUserName || "",
        showTemporaryPasswordNotice: Boolean(response.showTemporaryPasswordNotice),
      };
      setAccessStatus(status);
      setPortalUserName(status.movieHubUserName || "");
      return;
    }
    addNotification(
      accessStatusData.body?.error || "Failed to fetch moviehub access status",
      "error",
    );
  }, [accessStatusData, addNotification, user?.userId]);

  useEffect(() => {
    if (!createAccessRequestData) return;
    if (
      createAccessRequestData.status >= 200 &&
      createAccessRequestData.status < 300
    ) {
      addNotification("MovieHub access request submitted", "success");
      loadAccessStatus();
      setRequestedMovieHubUserName("");
      return;
    }
    addNotification(
      createAccessRequestData.body?.error || "Failed to submit access request",
      "error",
    );
  }, [createAccessRequestData, addNotification, loadAccessStatus]);

  useEffect(() => {
    if (!accessRequestsData) return;
    if (accessRequestsData.status >= 200 && accessRequestsData.status < 300) {
      setAccessRequests(accessRequestsData.body?.response || []);
      return;
    }
    addNotification(
      accessRequestsData.body?.error || "Failed to fetch access requests",
      "error",
    );
  }, [accessRequestsData, addNotification]);

  useEffect(() => {
    if (!approveAccessData) return;
    setApprovingAccessRequestId(null);
    if (approveAccessData.status >= 200 && approveAccessData.status < 300) {
      addNotification(
        "MovieHub access approved and credentials sent",
        "success",
      );
      loadAccessRequests();
      return;
    }
    addNotification(
      approveAccessData.body?.error || "Failed to approve access request",
      "error",
    );
  }, [approveAccessData, addNotification, loadAccessRequests]);

  useEffect(() => {
    if (!rejectAccessData) return;
    setRejectingAccessRequestId(null);
    if (rejectAccessData.status >= 200 && rejectAccessData.status < 300) {
      addNotification("MovieHub access request rejected", "success");
      loadAccessRequests();
      return;
    }
    addNotification(
      rejectAccessData.body?.error || "Failed to reject access request",
      "error",
    );
  }, [rejectAccessData, addNotification, loadAccessRequests]);

  useEffect(() => {
    if (!accessUsersData) return;
    if (accessUsersData.status >= 200 && accessUsersData.status < 300) {
      setAccessUsers(accessUsersData.body?.response || []);
      return;
    }
    addNotification(
      accessUsersData.body?.error || "Failed to fetch MovieHub users",
      "error",
    );
  }, [accessUsersData, addNotification]);

  useEffect(() => {
    if (!deleteAccessUserData) return;
    setDeletingAccessUserMappingId(null);
    if (deleteAccessUserData.status >= 200 && deleteAccessUserData.status < 300) {
      addNotification("MovieHub user deleted successfully", "success");
      loadAccessUsers();
      return;
    }
    addNotification(
      deleteAccessUserData.body?.error || "Failed to delete MovieHub user",
      "error",
    );
  }, [deleteAccessUserData, addNotification, loadAccessUsers]);

  useEffect(() => {
    if (!resendPasswordData) return;
    if (resendPasswordData.status >= 200 && resendPasswordData.status < 300) {
      addNotification(
        "Temporary password has been resent to your email",
        "success",
      );
      loadAccessStatus();
      return;
    }
    addNotification(
      resendPasswordData.body?.error || "Failed to resend temporary password",
      "error",
    );
  }, [resendPasswordData, addNotification, loadAccessStatus]);

  useEffect(() => {
    if (!confirmPasswordResetData) return;
    if (
      confirmPasswordResetData.status >= 200 &&
      confirmPasswordResetData.status < 300
    ) {
      addNotification("Password reset status updated", "success");
      loadAccessStatus();
      return;
    }
    addNotification(
      confirmPasswordResetData.body?.error ||
        "Failed to update password reset status",
      "error",
    );
  }, [confirmPasswordResetData, addNotification, loadAccessStatus]);

  useEffect(() => {
    if (!searchData) return;
    if (searchData.status >= 200 && searchData.status < 300) {
      setResults(searchData.body?.response || []);
      return;
    }
    addNotification(
      searchData.body?.error || "Failed to search media",
      "error",
    );
  }, [searchData, addNotification]);

  useEffect(() => {
    if (!createData) return;
    if (createData.status >= 200 && createData.status < 300) {
      const requestId = createData.body?.response?.requestId;
      if (isAdmin && requestId) {
        setAutoApproveRequestId(requestId);
        const { url, options } = MovieHubService.approveRequest(requestId);
        fetchApproveRequest(url, options);
        return;
      }
      addNotification("Request submitted successfully", "success");
      setActiveRequestKey(null);
      loadMyRequests();
      if (isAdmin) {
        loadAllRequests();
      }
      return;
    }
    setActiveRequestKey(null);
    addNotification(
      createData.body?.error || "Failed to create request",
      "error",
    );
  }, [
    createData,
    addNotification,
    isAdmin,
    fetchApproveRequest,
    loadMyRequests,
    loadAllRequests,
  ]);

  useEffect(() => {
    if (!requestsData) return;
    if (requestsData.status >= 200 && requestsData.status < 300) {
      setRequests(requestsData.body?.response || []);
      return;
    }
    addNotification(
      requestsData.body?.error || "Failed to fetch requests",
      "error",
    );
  }, [requestsData, addNotification]);

  useEffect(() => {
    if (!availableData) return;
    if (availableData.status >= 200 && availableData.status < 300) {
      setAvailableItems(availableData.body?.response || []);
      return;
    }
    addNotification(
      availableData.body?.error || "Failed to fetch available media",
      "error",
    );
  }, [availableData, addNotification]);

  useEffect(() => {
    if (!deleteAvailableData) return;
    setDeletingAvailableMediaId(null);
    if (deleteAvailableData.status >= 200 && deleteAvailableData.status < 300) {
      addNotification(
        deleteAvailableData.body?.response?.message || "Media deleted successfully",
        "success",
      );
      loadAvailableMedia(availableMediaType);
      return;
    }
    addNotification(
      deleteAvailableData.body?.error || "Failed to delete media",
      "error",
    );
  }, [
    deleteAvailableData,
    addNotification,
    loadAvailableMedia,
    availableMediaType,
  ]);

  useEffect(() => {
    if (!downloadsData) return;
    if (downloadsData.status >= 200 && downloadsData.status < 300) {
      setDownloadItems(downloadsData.body?.response?.downloads || []);
      setDownloadHandling(downloadsData.body?.response?.downloadHandling || null);
      return;
    }
    addNotification(
      downloadsData.body?.error || "Failed to fetch downloading status",
      "error",
    );
  }, [downloadsData, addNotification]);

  useEffect(() => {
    if (!pauseDownloadsData) return;
    setDownloadControlLoading(false);
    if (
      pauseDownloadsData.status >= 200 &&
      pauseDownloadsData.status < 300
    ) {
      addNotification("Download automation paused", "success");
      loadDownloadQueue(downloadScope);
      loadCompletedDownloads(downloadScope);
      return;
    }
    addNotification(
      pauseDownloadsData.body?.error || "Failed to pause downloads",
      "error",
    );
  }, [
    pauseDownloadsData,
    addNotification,
    loadDownloadQueue,
    loadCompletedDownloads,
    downloadScope,
  ]);

  useEffect(() => {
    if (!resumeDownloadsData) return;
    setDownloadControlLoading(false);
    if (
      resumeDownloadsData.status >= 200 &&
      resumeDownloadsData.status < 300
    ) {
      addNotification("Download automation resumed", "success");
      loadDownloadQueue(downloadScope);
      loadCompletedDownloads(downloadScope);
      return;
    }
    addNotification(
      resumeDownloadsData.body?.error || "Failed to resume downloads",
      "error",
    );
  }, [
    resumeDownloadsData,
    addNotification,
    loadDownloadQueue,
    loadCompletedDownloads,
    downloadScope,
  ]);

  useEffect(() => {
    if (!deleteDownloadData) return;
    setDeletingQueueItemKey(null);
    if (
      deleteDownloadData.status >= 200 &&
      deleteDownloadData.status < 300
    ) {
      addNotification("Download removed from queue", "success");
      loadDownloadQueue(downloadScope);
      loadCompletedDownloads(downloadScope);
      return;
    }
    addNotification(
      deleteDownloadData.body?.error || "Failed to delete download",
      "error",
    );
  }, [
    deleteDownloadData,
    addNotification,
    loadDownloadQueue,
    loadCompletedDownloads,
    downloadScope,
  ]);

  useEffect(() => {
    if (!completedDownloadsData) return;
    if (
      completedDownloadsData.status >= 200 &&
      completedDownloadsData.status < 300
    ) {
      setCompletedDownloadItems(
        completedDownloadsData.body?.response?.downloads || [],
      );
      return;
    }
    addNotification(
      completedDownloadsData.body?.error ||
        "Failed to fetch completed downloads",
      "error",
    );
  }, [completedDownloadsData, addNotification]);

  useEffect(() => {
    if (!adminRequestsData) return;
    if (adminRequestsData.status >= 200 && adminRequestsData.status < 300) {
      setAdminRequests(adminRequestsData.body?.response || []);
      return;
    }
    addNotification(
      adminRequestsData.body?.error || "Failed to fetch admin requests",
      "error",
    );
  }, [adminRequestsData, addNotification]);

  useEffect(() => {
    if (!ytFormatsData) return;
    if (ytFormatsData.status >= 200 && ytFormatsData.status < 300) {
      const response: MovieHubYtFormatsResponse = {
        ...(ytFormatsData.body || {}),
        formats: Array.isArray(ytFormatsData.body?.formats)
          ? ytFormatsData.body.formats
          : [],
      };
      setYtFormatsResponse(response);
      setYtDownloadError(null);

      const firstFormat = response.formats?.[0];
      if (firstFormat) {
        setSelectedYtFormat({
          quality: firstFormat.request_format?.quality || firstFormat.quality,
          ext: firstFormat.request_format?.ext || firstFormat.ext || "mp4",
        });
      } else {
        setSelectedYtFormat(null);
      }
      return;
    }
    addNotification(
      ytFormatsData.body?.error || "Failed to fetch YT formats",
      "error",
    );
  }, [ytFormatsData, addNotification]);

  useEffect(() => {
    if (!ytRequestsData) return;
    if (ytRequestsData.status >= 200 && ytRequestsData.status < 300) {
      const requests = Array.isArray(ytRequestsData.body?.response?.requests)
        ? (ytRequestsData.body.response.requests as MovieHubYtDownloadRequest[])
        : [];
      setYtDownloadRequests(requests);
      return;
    }
    addNotification(
      ytRequestsData.body?.error || "Failed to fetch YT download requests",
      "error",
    );
  }, [ytRequestsData, addNotification]);

  useEffect(() => {
    if (!ytLibraryData) return;
    if (ytLibraryData.status >= 200 && ytLibraryData.status < 300) {
      const items = Array.isArray(ytLibraryData.body?.response?.items)
        ? (ytLibraryData.body.response.items as MovieHubYtLibraryItem[])
        : [];
      setYtLibraryItems(items);
      return;
    }
    addNotification(
      ytLibraryData.body?.error || "Failed to fetch YT library items",
      "error",
    );
  }, [ytLibraryData, addNotification]);

  useEffect(() => {
    if (!deleteYtLibraryData) return;
    setDeletingYtLibraryItemId(null);
    if (deleteYtLibraryData.status >= 200 && deleteYtLibraryData.status < 300) {
      addNotification("YT library item deleted", "success");
      loadYtLibraryItems();
      loadYtDownloadRequests();
      return;
    }
    addNotification(
      deleteYtLibraryData.body?.error || "Failed to delete YT library item",
      "error",
    );
  }, [
    deleteYtLibraryData,
    addNotification,
    loadYtLibraryItems,
    loadYtDownloadRequests,
  ]);

  useEffect(() => {
    if (!deleteYtRequestData) return;
    setDeletingYtRequestId(null);
    if (deleteYtRequestData.status >= 200 && deleteYtRequestData.status < 300) {
      addNotification("YT download request deleted", "success");
      loadYtDownloadRequests();
      return;
    }
    addNotification(
      deleteYtRequestData.body?.error || "Failed to delete YT download request",
      "error",
    );
  }, [deleteYtRequestData, addNotification, loadYtDownloadRequests]);

  useEffect(() => {
    if (!approveData) return;
    const wasAutoApprove = Boolean(autoApproveRequestId);
    setAutoApproveRequestId(null);
    setApprovingRequestId(null);
    setActiveRequestKey(null);
    if (approveData.status >= 200 && approveData.status < 300) {
      addNotification(
        wasAutoApprove
          ? "Download queued successfully."
          : approveData.body?.response?.message ||
              "Request approved. Download queued and mail notification triggered.",
        "success",
      );
      loadMyRequests();
      loadAllRequests();
      return;
    }
    addNotification(
      approveData.body?.error || "Failed to approve request",
      "error",
    );
  }, [
    approveData,
    addNotification,
    autoApproveRequestId,
    loadMyRequests,
    loadAllRequests,
  ]);

  useEffect(() => {
    if (!deleteData) return;
    setDeletingRequestId(null);
    if (deleteData.status >= 200 && deleteData.status < 300) {
      addNotification("Request deleted successfully", "success");
      loadMyRequests();
      if (isAdmin) loadAllRequests();
      return;
    }
    addNotification(
      deleteData.body?.error || "Failed to delete request",
      "error",
    );
  }, [deleteData, addNotification, isAdmin]);

  useEffect(() => {
    if (activeSection === "admin_approve" && isAdmin) {
      loadAllRequests();
    }
  }, [activeSection, isAdmin, loadAllRequests]);

  useEffect(() => {
    if (activeSection === "admin_access" && isAdmin) {
      loadAccessRequests();
    }
  }, [activeSection, isAdmin, loadAccessRequests]);

  useEffect(() => {
    if (activeSection === "admin_users" && isAdmin) {
      loadAccessUsers();
    }
  }, [activeSection, isAdmin, loadAccessUsers]);

  useEffect(() => {
    if (activeSection === "admin_yt_download" && isAdmin) {
      loadYtDownloadRequests();
      loadYtLibraryItems();
    }
  }, [activeSection, isAdmin, loadYtDownloadRequests, loadYtLibraryItems]);

  useEffect(() => {
    if (!isAdmin || activeSection !== "admin_yt_download") return;

    const downloadingVideoIds = Array.from(
      new Set(
        ytDownloadRequests
          .filter(
            (request) =>
              request.status?.toUpperCase() === "DOWNLOADING" &&
              Boolean(request.videoId),
          )
          .map((request) => (request.videoId || "").trim())
          .filter((videoId) => videoId.length > 0),
      ),
    );

    if (downloadingVideoIds.length === 0) {
      setYtStatusByVideoId({});
      return;
    }

    setYtStatusByVideoId((prev) => {
      const next: Record<string, Record<string, unknown>> = {};
      downloadingVideoIds.forEach((videoId) => {
        if (prev[videoId]) {
          next[videoId] = prev[videoId];
        }
      });
      return next;
    });

    const controllers = downloadingVideoIds.map((videoId) => {
      const controller = new AbortController();
      void streamDownloadingStatus(videoId, controller.signal);
      return controller;
    });

    return () => {
      controllers.forEach((controller) => controller.abort());
    };
  }, [activeSection, isAdmin, ytDownloadRequests, streamDownloadingStatus]);

  useEffect(() => {
    const sectionTitle = isChatPage
      ? "MovieHub AI Chat"
      : sectionConfig.find((section) => section.id === activeSection)?.label ||
        "MovieHub";
    document.title = `${sectionTitle} | ToolHub`;
  }, [activeSection, isChatPage, sectionConfig]);

  useEffect(() => {
    if (activeSection !== "available") return;
    loadAvailableMedia(availableMediaType);
  }, [activeSection, availableMediaType, loadAvailableMedia]);

  useEffect(() => {
    if (activeSection !== "downloading") return;
    loadDownloadQueue(downloadScope);
    loadCompletedDownloads(downloadScope);
  }, [activeSection, downloadScope, loadDownloadQueue, loadCompletedDownloads]);

  const handleSearch = useCallback(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      addNotification("Please enter a movie/show name", "warning");
      return;
    }
    const { url, options } = MovieHubService.search(trimmedQuery, mediaType);
    fetchSearch(url, options);
  }, [query, addNotification, mediaType, fetchSearch]);

  const getResultKey = useCallback((result: MovieHubSearchResult) => {
    const identity = result.mediaType === "MOVIES"
      ? result.tmdbId ?? result.imdbId ?? "na"
      : result.tvdbId ?? result.imdbId ?? "na";
    return `${result.mediaType}-${identity}-${result.title}-${result.year || "na"}`;
  }, []);

  const toggleSeason = useCallback((resultKey: string, season: number) => {
    setSeasonsByResult((prev) => {
      const selected = prev[resultKey] || [];
      const updated = selected.includes(season)
        ? selected.filter((item) => item !== season)
        : [...selected, season].sort((a, b) => a - b);
      return { ...prev, [resultKey]: updated };
    });
  }, []);

  const handleCreateRequest = useCallback(
    (result: MovieHubSearchResult) => {
      const resultKey = getResultKey(result);
      const quality = qualityByResult[resultKey] || DEFAULT_QUALITY;
      const selectedSeasons = seasonsByResult[resultKey] || [];

      if (result.mediaType === "SHOWS" && selectedSeasons.length === 0) {
        addNotification("Select at least one season for a series", "warning");
        return;
      }

      setActiveRequestKey(resultKey);
      const { url, options } = MovieHubService.createRequest({
        title: result.title,
        mediaType: result.mediaType,
        tmdbId: result.tmdbId,
        tvdbId: result.tvdbId,
        imdbId: result.imdbId,
        qualityProfileId: quality,
        ...(result.mediaType === "SHOWS" ? { season: selectedSeasons } : {}),
      });
      fetchCreateRequest(url, options);
    },
    [
      getResultKey,
      qualityByResult,
      seasonsByResult,
      addNotification,
      fetchCreateRequest,
    ],
  );

  const handleApproveRequest = useCallback(
    (requestId: string) => {
      setApprovingRequestId(requestId);
      const { url, options } = MovieHubService.approveRequest(requestId);
      fetchApproveRequest(url, options);
    },
    [fetchApproveRequest],
  );

  const handleDeleteRequest = useCallback(
    (requestId: string) => {
      setDeletingRequestId(requestId);
      const { url, options } = MovieHubService.deleteRequest(requestId);
      fetchDeleteRequest(url, options);
    },
    [fetchDeleteRequest],
  );

  const handleDeleteAvailableMedia = useCallback(
    (item: MovieHubAvailableMedia, season?: number) => {
      const mediaId =
        item.mediaType === "MOVIES" ? item.radarrId : item.sonarrId;
      if (!mediaId) {
        addNotification("Unable to determine library item id", "error");
        return;
      }
      const isSeasonDelete = item.mediaType === "SHOWS" && season !== undefined;
      const confirmed = window.confirm(
        isSeasonDelete
          ? `Delete season ${season} of ${item.title} from MovieHub and remove the season files from disk?`
          : `Delete ${item.title} from MovieHub and remove the files from disk?`,
      );
      if (!confirmed) return;
      const deleteKey = isSeasonDelete
        ? `${item.mediaType}-${mediaId}-S${season}`
        : `${item.mediaType}-${mediaId}`;
      setDeletingAvailableMediaId(deleteKey);
      const { url, options } = MovieHubService.deleteAvailableMedia({
        id: mediaId,
        mediaType: item.mediaType,
        deleteFiles: true,
        ...(isSeasonDelete ? { season: [season] } : {}),
      });
      fetchDeleteAvailableMedia(url, options);
    },
    [addNotification, fetchDeleteAvailableMedia],
  );

  const handlePauseDownloads = useCallback(() => {
    const confirmed = window.confirm(
      "Pause MovieHub download automation across Radarr and Sonarr?",
    );
    if (!confirmed) return;
    setDownloadControlLoading(true);
    const { url, options } = MovieHubService.pauseDownloads();
    fetchPauseDownloads(url, options);
  }, [fetchPauseDownloads]);

  const handleResumeDownloads = useCallback(() => {
    setDownloadControlLoading(true);
    const { url, options } = MovieHubService.resumeDownloads();
    fetchResumeDownloads(url, options);
  }, [fetchResumeDownloads]);

  const handleDeleteDownload = useCallback(
    (item: MovieHubDownloadItem) => {
      const queueItemId = Number(item.queueItemId);
      if (!Number.isFinite(queueItemId) || queueItemId <= 0) {
        addNotification("Unable to determine queue item id", "error");
        return;
      }
      const confirmed = window.confirm(
        `Remove ${item.title} from the active download queue?`,
      );
      if (!confirmed) return;
      const deleteKey = `${item.mediaType}-${queueItemId}`;
      setDeletingQueueItemKey(deleteKey);
      const { url, options } = MovieHubService.deleteDownload({
        queueItemId,
        mediaType: item.mediaType,
        removeFromClient: true,
        blocklist: false,
        skipRedownload: true,
        changeCategory: false,
      });
      fetchDeleteDownload(url, options);
    },
    [addNotification, fetchDeleteDownload],
  );

  const handleCreateAccessRequest = useCallback(() => {
    const username = requestedMovieHubUserName.trim();
    if (!username) {
      addNotification("Please enter moviehub username", "warning");
      return;
    }
    const { url, options } = MovieHubService.createAccessRequest(username);
    fetchCreateAccessRequest(url, options);
  }, [requestedMovieHubUserName, addNotification, fetchCreateAccessRequest]);

  const handleApproveAccessRequest = useCallback(
    (requestId: string) => {
      setApprovingAccessRequestId(requestId);
      const { url, options } = MovieHubService.approveAccessRequest(requestId);
      fetchApproveAccessRequest(url, options);
    },
    [fetchApproveAccessRequest],
  );

  const handleRejectAccessRequest = useCallback(
    (requestId: string) => {
      setRejectingAccessRequestId(requestId);
      const { url, options } = MovieHubService.rejectAccessRequest(requestId);
      fetchRejectAccessRequest(url, options);
    },
    [fetchRejectAccessRequest],
  );

  const handleDeleteAccessUser = useCallback(
    (mappingId: string) => {
      setDeletingAccessUserMappingId(mappingId);
      const { url, options } = MovieHubService.deleteAccessUser(mappingId);
      fetchDeleteAccessUser(url, options);
    },
    [fetchDeleteAccessUser],
  );

  const handleOpenMovieHub = useCallback((url: string) => {
    window.open(
      url,
      "_blank",
      "noopener,noreferrer",
    );
  }, []);

  const handleResendPassword = useCallback(() => {
    const { url, options } = MovieHubService.resendTemporaryPassword();
    fetchResendPassword(url, options);
  }, [fetchResendPassword]);

  const handleConfirmPasswordReset = useCallback(() => {
    const { url, options } = MovieHubService.confirmPasswordReset();
    fetchConfirmPasswordReset(url, options);
  }, [fetchConfirmPasswordReset]);

  const handleClearSearch = useCallback(() => {
    setQuery("");
    setResults([]);
    setQualityByResult({});
    setSeasonsByResult({});
    setActiveRequestKey(null);
  }, []);

  const handleFetchYtFormats = useCallback(() => {
    const trimmedUrl = ytUrl.trim();
    if (!trimmedUrl) {
      addNotification("Please enter a YouTube URL", "warning");
      return;
    }
    const { url, options } = MovieHubService.getYtFormats(trimmedUrl);
    fetchYtFormats(url, options);
  }, [ytUrl, addNotification, fetchYtFormats]);

  const handleSongModeChange = useCallback((value: boolean) => {
    setYtIsSong(value);
    if (value) {
      setYtPassDownloadPath(false);
      setYtDownloadPath("");
    }
  }, []);

  const handlePassDownloadPathChange = useCallback(
    (value: boolean) => {
      if (ytIsSong && value) return;
      setYtPassDownloadPath(value);
      if (!value) {
        setYtDownloadPath("");
      }
    },
    [ytIsSong],
  );

  const handleDownloadYtToServer = useCallback(() => {
    const startDownload = async () => {
      if (ytDownloadInProgress) return;
      const trimmedUrl = ytUrl.trim();
      const trimmedDownloadPath = ytDownloadPath.trim();
      if (!trimmedUrl) {
        addNotification("Please enter a YouTube URL", "warning");
        return;
      }
      if (!selectedYtFormat?.quality) {
        addNotification("Please select a format", "warning");
        return;
      }
      if (!ytIsSong && ytPassDownloadPath && !trimmedDownloadPath) {
        addNotification("Please enter a download path or disable the toggle", "warning");
        return;
      }
      const videoId = ytFormatsResponse?.id?.trim() || "";
      if (!videoId) {
        addNotification(
          "Unable to determine videoId. Please fetch formats again.",
          "warning",
        );
        return;
      }

      setYtDownloadInProgress(true);
      setYtDownloadError(null);

      try {
        const { url: addUrl, options: addOptions } = MovieHubService.addYtDownload({
          videoId,
          url: trimmedUrl,
          title: ytFormatsResponse?.title || "",
          format: {
            quality: selectedYtFormat.quality,
            ext: selectedYtFormat.ext || "mp4",
          },
          ...(ytIsSong ? { isSong: true } : {}),
          ...(ytFilename.trim() ? { filename: ytFilename.trim() } : {}),
          ...(!ytIsSong && ytPassDownloadPath && trimmedDownloadPath
            ? { download_path: trimmedDownloadPath }
            : {}),
        });

        const addResponse = await fetch(addUrl, addOptions);
        const addBody = await addResponse.json().catch(() => null);
        if (!addResponse.ok) {
          const errorMessage =
            addBody?.error || addBody?.message || "Failed to add YT download request";
          setYtDownloadError(errorMessage);
          addNotification(errorMessage, "error");
          return;
        }

        const { url: startUrl, options: startOptions } =
          MovieHubService.startYtDownload();
        const startResponse = await fetch(startUrl, startOptions);
        const startBody = await startResponse.json().catch(() => null);
        if (!startResponse.ok) {
          const errorMessage =
            startBody?.error || startBody?.message || "Failed to trigger YT download start";
          setYtDownloadError(errorMessage);
          addNotification(errorMessage, "error");
          return;
        }
        addNotification(
          startBody?.response?.message || "Download request queued successfully",
          "success",
        );
        loadYtDownloadRequests();
        loadYtLibraryItems();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to queue YT download request";
        setYtDownloadError(message);
        addNotification(message, "error");
      } finally {
        setYtDownloadInProgress(false);
      }
    };

    void startDownload();
  }, [
    ytDownloadInProgress,
    ytUrl,
    ytDownloadPath,
    ytIsSong,
    ytPassDownloadPath,
    selectedYtFormat,
    ytFormatsResponse?.id,
    ytFormatsResponse?.title,
    ytFilename,
    addNotification,
    loadYtDownloadRequests,
    loadYtLibraryItems,
  ]);

  const handleClearYtSearch = useCallback(() => {
    setYtDownloadInProgress(false);
    setYtUrl("");
    setYtFilename("");
    setYtPassDownloadPath(false);
    setYtDownloadPath("");
    setYtIsSong(false);
    setYtFormatsResponse(null);
    setSelectedYtFormat(null);
    setYtDownloadError(null);
    setYtStatusByVideoId({});
  }, []);

  const handleDeleteYtLibraryItem = useCallback(
    (itemId: string) => {
      if (!itemId) return;
      setDeletingYtLibraryItemId(itemId);
      const { url, options } = MovieHubService.deleteYtLibraryItem(itemId);
      fetchDeleteYtLibraryItem(url, options);
    },
    [fetchDeleteYtLibraryItem],
  );

  const handleDeleteYtRequest = useCallback(
    (requestId: string) => {
      if (!requestId) return;
      setDeletingYtRequestId(requestId);
      const { url, options } = MovieHubService.deleteYtDownloadRequest(requestId);
      fetchDeleteYtRequest(url, options);
    },
    [fetchDeleteYtRequest],
  );

  const handleSelectSection = useCallback(
    (section: MovieHubSection) => {
      if (section === "status" && authToken && !isAuthLoading) {
        loadMyRequests();
      }
      setActiveSection(section);
      navigate(MOVIEHUB_SECTION_ROUTES[section]);
    },
    [navigate, authToken, isAuthLoading, loadMyRequests],
  );

  const handlePlayMedia = useCallback(
    (item: MovieHubAvailableMedia) => {
      if (!portalUserName.trim()) {
        addNotification(
          "Open the Watch tab and sign in to MovieHub before starting playback",
          "warning",
        );
        setActiveSection("open");
        navigate(MOVIEHUB_SECTION_ROUTES.open);
        return;
      }
      setPlayingMediaTitle(item.title);
      setActiveSection("open");
      navigate(MOVIEHUB_SECTION_ROUTES.open);
      const { url, options } = MovieHubService.playMedia(
        item,
        portalUserName,
      );
      window.setTimeout(() => fetchPlayMedia(url, options), 350);
    },
    [addNotification, fetchPlayMedia, navigate, portalUserName],
  );

  const handleSetMediaType = useCallback((type: "MOVIES" | "SHOWS") => {
    setMediaType(type);
  }, []);

  const handleSetAvailableMediaType = useCallback(
    (type: "MOVIES" | "SHOWS") => {
      setAvailableMediaType(type);
    },
    [],
  );

  const handleSetDownloadScope = useCallback((scope: MovieHubDownloadScope) => {
    setDownloadScope(scope);
  }, []);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
  }, []);

  const handleQualityChange = useCallback(
    (resultKey: string, quality: MovieHubQuality) => {
      setQualityByResult((prev) => ({
        ...prev,
        [resultKey]: quality,
      }));
    },
    [],
  );

  const refreshAvailable = useCallback(() => {
    loadAvailableMedia(availableMediaType);
  }, [loadAvailableMedia, availableMediaType]);

  const refreshDownloadQueue = useCallback(() => {
    loadDownloadQueue(downloadScope);
    loadCompletedDownloads(downloadScope);
  }, [loadDownloadQueue, loadCompletedDownloads, downloadScope]);

  const sortedRequests = useMemo(() => {
    return [...requests].sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [requests]);

  const sortedAdminRequests = useMemo(() => {
    return [...adminRequests].sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [adminRequests]);

  const sortedAccessRequests = useMemo(() => {
    return [...accessRequests].sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [accessRequests]);

  const sortedAccessUsers = useMemo(() => {
    return [...accessUsers].sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [accessUsers]);

  const sortedAvailableItems = useMemo(() => {
    return [...availableItems].sort((a, b) =>
      (a.title || "").localeCompare(b.title || "", undefined, {
        sensitivity: "base",
      }),
    );
  }, [availableItems]);

  const sortedDownloadItems = useMemo(() => {
    return [...downloadItems].sort((a, b) => {
      const aTime = a.added ? new Date(a.added).getTime() : 0;
      const bTime = b.added ? new Date(b.added).getTime() : 0;
      return bTime - aTime;
    });
  }, [downloadItems]);

  const sortedCompletedDownloadItems = useMemo(() => {
    return [...completedDownloadItems].sort((a, b) => {
      const aTime = a.downloadedAt ? new Date(a.downloadedAt).getTime() : 0;
      const bTime = b.downloadedAt ? new Date(b.downloadedAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [completedDownloadItems]);

  const isOpenPortalView = !isChatPage && activeSection === "open";

  if (isAuthLoading || isUnauthenticated) {
    return <Loader />;
  }

  if (!isAdmin && !accessStatus) {
    return <Loader />;
  }

  if (!isAdmin && !hasMovieHubAccess) {
    return (
      <div className="min-h-screen w-full moviehub-bg pt-[calc(5rem+env(safe-area-inset-top))] sm:pt-24 pb-8 sm:pb-12 px-4 overflow-x-hidden">
        <MovieHubAccessGateSection
          accessStatus={accessStatus}
          requestedUserName={requestedMovieHubUserName}
          loading={createAccessRequestLoading || accessStatusLoading}
          onRequestedUserNameChange={setRequestedMovieHubUserName}
          onRequestAccess={handleCreateAccessRequest}
          onRefreshStatus={loadAccessStatus}
        />
      </div>
    );
  }

  return (
    <div
      className={`portal-page moviehub-cinema-page w-full overflow-x-hidden ${
        isOpenPortalView
          ? "h-[100dvh] max-h-[100dvh] min-h-0 overflow-hidden pt-16"
          : "min-h-screen pb-10 pt-16"
      }`}
    >
      <div
        className={`mx-auto flex w-full flex-col ${
          isOpenPortalView
            ? "h-full min-h-0 max-w-none"
            : "max-w-[1600px]"
        }`}
      >
        <div
          className={`flex min-h-0 flex-col ${
            isOpenPortalView ? "h-full" : ""
          }`}
        >
          <MovieHubNav
            sectionConfig={sectionConfig}
            activeSection={activeSection}
            onSelectSection={handleSelectSection}
          />

          <section
            className={`min-w-0 ${
              isOpenPortalView
                ? "flex min-h-0 flex-1 flex-col"
                : "px-3 pb-6 pt-4 sm:px-5 lg:px-8"
            }`}
          >
            <div
              className={`relative overflow-x-hidden ${
                isOpenPortalView
                  ? "min-h-0 flex-1 overflow-hidden"
                  : "min-h-[520px]"
              }`}
            >
              {isChatPage && (
                <CinePilotChat
                  mode="page"
                  onClose={() => navigate("/moviehub")}
                  onCollapseToWidget={() => {
                    navigate("/moviehub");
                    setShowCinePilot(true);
                  }}
                />
              )}

              {!isChatPage && (
                <div
                  className={
                    activeSection === "open"
                      ? "flex h-full min-h-0 w-full flex-1"
                      : "hidden"
                  }
                >
                  <MovieHubOpenSection
                    isAdmin={isAdmin}
                    username={portalUserName}
                    userEmail={accessStatus?.email || ""}
                    portalUrl={MOVIEHUB_PORTAL_URL}
                    sessionKey={`${toolHubSessionKey}:${portalUserName || "pending"}`}
                    showTemporaryPasswordNotice={Boolean(
                      accessStatus?.showTemporaryPasswordNotice,
                    )}
                    resending={resendPasswordLoading}
                    confirmingPasswordReset={confirmPasswordResetLoading}
                    onOpenExternal={handleOpenMovieHub}
                    onResendPassword={handleResendPassword}
                    onConfirmPasswordReset={handleConfirmPasswordReset}
                  />
                </div>
              )}

              {!isChatPage && activeSection === "request" && (
                <MovieHubRequestSection
                  isAdmin={isAdmin}
                  mediaType={mediaType}
                  query={query}
                  results={results}
                  qualityByResult={qualityByResult}
                  seasonsByResult={seasonsByResult}
                  activeRequestKey={activeRequestKey}
                  searchLoading={searchLoading}
                  createLoading={createLoading}
                  directDownloadLoading={Boolean(autoApproveRequestId)}
                  isBusy={isBusy}
                  onMediaTypeChange={handleSetMediaType}
                  onQueryChange={handleQueryChange}
                  onSearch={handleSearch}
                  onClear={handleClearSearch}
                  onQualityChange={handleQualityChange}
                  onToggleSeason={toggleSeason}
                  onPlaceRequest={handleCreateRequest}
                  getResultKey={getResultKey}
                />
              )}

              {!isChatPage && activeSection === "status" && (
                <MovieHubStatusSection
                  requestsLoading={requestsLoading}
                  sortedRequests={sortedRequests}
                  deleteLoading={deleteLoading}
                  deletingRequestId={deletingRequestId}
                  onRefresh={loadMyRequests}
                  onDelete={handleDeleteRequest}
                  formatDateTime={formatDateTime}
                />
              )}

              {!isChatPage && activeSection === "admin_approve" && isAdmin && (
                <MovieHubAdminSection
                  adminRequestsLoading={adminRequestsLoading}
                  approveLoading={approveLoading}
                  deleteLoading={deleteLoading}
                  approvingRequestId={approvingRequestId}
                  deletingRequestId={deletingRequestId}
                  sortedAdminRequests={sortedAdminRequests}
                  onRefresh={loadAllRequests}
                  onApprove={handleApproveRequest}
                  onDelete={handleDeleteRequest}
                  formatDateTime={formatDateTime}
                />
              )}

              {!isChatPage && activeSection === "admin_access" && isAdmin && (
                <MovieHubAccessAdminSection
                  requests={sortedAccessRequests}
                  loading={
                    accessRequestsLoading ||
                    approveAccessLoading ||
                    rejectAccessLoading
                  }
                  approvingRequestId={approvingAccessRequestId}
                  rejectingRequestId={rejectingAccessRequestId}
                  onRefresh={loadAccessRequests}
                  onApprove={handleApproveAccessRequest}
                  onReject={handleRejectAccessRequest}
                  formatDateTime={formatDateTime}
                />
              )}

              {!isChatPage &&
                activeSection === "admin_yt_download" &&
                isAdmin && (
                  <MovieHubYtAdminSection
                    ytUrl={ytUrl}
                    filename={ytFilename}
                    passDownloadPath={ytPassDownloadPath}
                    downloadPath={ytDownloadPath}
                    isSong={ytIsSong}
                    formatsLoading={ytFormatsLoading}
                    downloadInProgress={ytDownloadInProgress}
                    formatsResponse={ytFormatsResponse}
                    selectedFormat={selectedYtFormat}
                    downloadError={ytDownloadError}
                    ytRequestsLoading={ytRequestsLoading}
                    ytRequests={ytDownloadRequests}
                    ytStatusByVideoId={ytStatusByVideoId}
                    ytLibraryLoading={ytLibraryLoading}
                    ytLibraryItems={ytLibraryItems}
                    deletingYtRequestId={deletingYtRequestId}
                    deletingYtLibraryItemId={deletingYtLibraryItemId}
                    formatDateTime={formatDateTime}
                    onYtUrlChange={setYtUrl}
                    onFilenameChange={setYtFilename}
                    onPassDownloadPathChange={handlePassDownloadPathChange}
                    onDownloadPathChange={setYtDownloadPath}
                    onSongChange={handleSongModeChange}
                    onFetchFormats={handleFetchYtFormats}
                    onClearSearch={handleClearYtSearch}
                    onFormatChange={setSelectedYtFormat}
                    onDownloadToServer={handleDownloadYtToServer}
                    onRefreshRequests={loadYtDownloadRequests}
                    onDeleteRequest={handleDeleteYtRequest}
                    onRefreshLibraryItems={loadYtLibraryItems}
                    onDeleteLibraryItem={handleDeleteYtLibraryItem}
                  />
                )}

              {!isChatPage && activeSection === "admin_users" && isAdmin && (
                <MovieHubUsersAdminSection
                  users={sortedAccessUsers}
                  loading={accessUsersLoading || deleteAccessUserLoading}
                  deletingMappingId={deletingAccessUserMappingId}
                  onRefresh={loadAccessUsers}
                  onDelete={handleDeleteAccessUser}
                  formatDateTime={formatDateTime}
                />
              )}

              {!isChatPage && activeSection === "available" && (
                <MovieHubAvailableSection
                  availableLoading={availableLoading}
                  isAdmin={isAdmin}
                  availableMediaType={availableMediaType}
                  sortedAvailableItems={sortedAvailableItems}
                  deletingMediaId={deletingAvailableMediaId}
                  onSetMediaType={handleSetAvailableMediaType}
                  onRefresh={refreshAvailable}
                  onDelete={handleDeleteAvailableMedia}
                  formatDateTime={formatDateTime}
                  onWatch={handlePlayMedia}
                  playingMediaTitle={playingMediaTitle}
                />
              )}

              {!isChatPage && activeSection === "downloading" && (
                <MovieHubDownloadingSection
                  downloadsLoading={
                    downloadsLoading || completedDownloadsLoading
                  }
                  isAdmin={isAdmin}
                  downloadScope={downloadScope}
                  downloadHandling={downloadHandling}
                  downloadControlLoading={downloadControlLoading}
                  deletingQueueItemKey={deletingQueueItemKey}
                  downloadItems={sortedDownloadItems}
                  completedDownloadItems={sortedCompletedDownloadItems}
                  onSetDownloadScope={handleSetDownloadScope}
                  onRefresh={refreshDownloadQueue}
                  onPause={handlePauseDownloads}
                  onResume={handleResumeDownloads}
                  onDeleteDownload={handleDeleteDownload}
                  formatDateTime={formatDateTime}
                />
              )}
            </div>
          </section>
        </div>
      </div>
      {!isChatPage && (
        <>
          <CinePilotLauncher onClick={() => setShowCinePilot(true)} />
          {showCinePilot && (
            <CinePilotChat
              mode="widget"
              onClose={() => setShowCinePilot(false)}
              onExpand={() => {
                setShowCinePilot(false);
                navigate("/moviehub/chat");
              }}
            />
          )}
        </>
      )}
    </div>
  );
};

export default MovieHub;

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
  MovieHubDownloadItem,
  MovieHubDownloadScope,
  MovieHubQuality,
  MovieHubRequest,
  MovieHubSearchResult,
  MovieHubService,
} from "../apis/moviehub/moviehub";
import { Loader } from "./Loader";
import { useNotification } from "../context/NotificationContext";
import { MovieHubSection, SectionConfig } from "./moviehub/types";
import { MovieHubNav } from "./moviehub/MovieHubNav";
import { MovieHubTopBar } from "./moviehub/MovieHubTopBar";
import { MovieHubRequestSection } from "./moviehub/MovieHubRequestSection";
import { MovieHubStatusSection } from "./moviehub/MovieHubStatusSection";
import { MovieHubAdminSection } from "./moviehub/MovieHubAdminSection";
import { MovieHubAvailableSection } from "./moviehub/MovieHubAvailableSection";
import { MovieHubDownloadingSection } from "./moviehub/MovieHubDownloadingSection";
import { MovieHubAccessGateSection } from "./moviehub/MovieHubAccessGateSection";
import { MovieHubOpenSection } from "./moviehub/MovieHubOpenSection";
import { MovieHubAccessAdminSection } from "./moviehub/MovieHubAccessAdminSection";
import { MovieHubUsersAdminSection } from "./moviehub/MovieHubUsersAdminSection";
import { CinePilotLauncher } from "./CineBotLauncher";
import { CinePilotChat } from "./CineBot";

const DEFAULT_QUALITY: MovieHubQuality = "any";

const formatDateTime = (value?: string) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export const MovieHub: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { authToken, isAuthLoading, user } = useAuth();
  const { addNotification } = useNotification();
  const isAdmin = user?.role === "ADMIN";
  const isChatPage = location.pathname.startsWith("/moviehub/chat");

  const [activeSection, setActiveSection] = useState<MovieHubSection>("open");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
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
    loading: downloadsLoading,
    data: downloadsData,
    fetchData: fetchDownloadQueue,
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
        id: "open",
        label: "Open Streaming Portal",
        compactLabel: "OP",
      },
      {
        id: "request",
        label: isAdmin ? "Search & Download" : "Request a Movie/Series",
        compactLabel: "RQ",
      },
      {
        id: "status",
        label: "My Requests",
        compactLabel: "ST",
      },
      {
        id: "available",
        label: "Available Library",
        compactLabel: "AV",
      },
      {
        id: "downloading",
        label: "Download Queue",
        compactLabel: "DL",
      },
    ];
    if (!isAdmin) return baseSectionConfig;
    return [
      ...baseSectionConfig.filter((section) =>
        ["open", "request"].includes(section.id),
      ),
      {
        id: "admin_approve" as MovieHubSection,
        label: "Review Download Requests",
        compactLabel: "AP",
        adminOnly: true,
        badgeCount: pendingAdminRequestsCount,
      },
      {
        id: "admin_access" as MovieHubSection,
        label: "Review Access Requests",
        compactLabel: "AC",
        adminOnly: true,
        badgeCount: pendingAccessRequestsCount,
      },
      {
        id: "admin_users" as MovieHubSection,
        label: "Manage Members",
        compactLabel: "US",
        adminOnly: true,
      },
      ...baseSectionConfig.filter((section) =>
        ["available", "downloading"].includes(section.id),
      ),
    ];
  }, [isAdmin, pendingAdminRequestsCount, pendingAccessRequestsCount]);

  useEffect(() => {
    if (isUnauthenticated) {
      navigate("/login", { state: { from: "/moviehub" } });
    }
  }, [isUnauthenticated, navigate]);

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
      const resolvedStatus =
        response.status || (response.exists ? "APPROVED" : "NOT_REQUESTED");
      const status: MovieHubAccessStatus = {
        hasAccess: Boolean(response.exists),
        exists: Boolean(response.exists),
        status: resolvedStatus,
        email: response.email || "",
        movieHubUserName: response.movieHubUserName || "",
        showTemporaryPasswordNotice: Boolean(response.showTemporaryPasswordNotice),
      };
      setAccessStatus(status);
      if (status?.movieHubUserName && !portalUserName) {
        setPortalUserName(status.movieHubUserName);
      }
      return;
    }
    addNotification(
      accessStatusData.body?.error || "Failed to fetch moviehub access status",
      "error",
    );
  }, [accessStatusData, portalUserName, addNotification]);

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
    if (!downloadsData) return;
    if (downloadsData.status >= 200 && downloadsData.status < 300) {
      setDownloadItems(downloadsData.body?.response?.downloads || []);
      return;
    }
    addNotification(
      downloadsData.body?.error || "Failed to fetch downloading status",
      "error",
    );
  }, [downloadsData, addNotification]);

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
    setIsMobileNavOpen(false);
  }, [activeSection]);

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
    return `${result.mediaType}-${result.title}-${result.year || "na"}`;
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

  const handleOpenMovieHub = useCallback(() => {
    window.open(
      "https://openmovies.hostingfrompurva.xyz",
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

  const handleSelectSection = useCallback(
    (section: MovieHubSection) => {
      if (isChatPage) {
        navigate("/moviehub");
      }
      if (section === "status" && authToken && !isAuthLoading) {
        loadMyRequests();
      }
      setActiveSection(section);
    },
    [isChatPage, navigate, authToken, isAuthLoading, loadMyRequests],
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

  const openMobileNav = useCallback(() => setIsMobileNavOpen(true), []);
  const closeMobileNav = useCallback(() => setIsMobileNavOpen(false), []);
  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev);
  }, []);

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

  const activeSectionConfig = sectionConfig.find(
    (section) => section.id === activeSection,
  );

  if (isAuthLoading || isUnauthenticated) {
    return <Loader />;
  }

  if (!isAdmin && !accessStatus) {
    return <Loader />;
  }

  if (!isAdmin && !hasMovieHubAccess) {
    return (
      <div className="min-h-screen w-full moviehub-bg pt-16 sm:pt-20 pb-8 sm:pb-12 px-4 overflow-x-hidden">
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
    <div className="min-h-screen w-full moviehub-bg pt-16 sm:pt-20 pb-8 sm:pb-12 px-4 overflow-x-hidden">
      <div className="max-w-7xl mx-auto">
        <div
          className={`grid grid-cols-1 gap-4 md:gap-6 md:items-start ${
            isSidebarCollapsed
              ? "md:grid-cols-[72px_minmax(0,1fr)]"
              : "md:grid-cols-[300px_minmax(0,1fr)]"
          }`}
        >
          <MovieHubNav
            sectionConfig={sectionConfig}
            activeSection={activeSection}
            isSidebarCollapsed={isSidebarCollapsed}
            isMobileNavOpen={isMobileNavOpen}
            onToggleSidebar={toggleSidebar}
            onCloseMobileNav={closeMobileNav}
            onSelectSection={handleSelectSection}
          />

          <section className="min-w-0 space-y-4">
            <MovieHubTopBar
              sectionLabel={
                isChatPage
                  ? "CinePilot Assistant"
                  : activeSectionConfig?.label || "Media workspace"
              }
              compactLabel={
                isChatPage ? "AI" : activeSectionConfig?.compactLabel || ""
              }
              onOpenMobileNav={openMobileNav}
            />

            <div className="moviehub-panel rounded-2xl p-4 sm:p-6 min-h-[520px] overflow-x-hidden relative">
              <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/70 to-transparent" />
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

              {!isChatPage && activeSection === "open" && (
                <MovieHubOpenSection
                  isAdmin={isAdmin}
                  username={portalUserName}
                  userEmail={accessStatus?.email || ""}
                  showTemporaryPasswordNotice={Boolean(
                    accessStatus?.showTemporaryPasswordNotice,
                  )}
                  resending={resendPasswordLoading}
                  confirmingPasswordReset={confirmPasswordResetLoading}
                  onOpen={handleOpenMovieHub}
                  onResendPassword={handleResendPassword}
                  onConfirmPasswordReset={handleConfirmPasswordReset}
                />
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
                  availableMediaType={availableMediaType}
                  sortedAvailableItems={sortedAvailableItems}
                  onSetMediaType={handleSetAvailableMediaType}
                  onRefresh={refreshAvailable}
                  formatDateTime={formatDateTime}
                />
              )}

              {!isChatPage && activeSection === "downloading" && (
                <MovieHubDownloadingSection
                  downloadsLoading={
                    downloadsLoading || completedDownloadsLoading
                  }
                  isAdmin={isAdmin}
                  downloadScope={downloadScope}
                  downloadItems={sortedDownloadItems}
                  completedDownloadItems={sortedCompletedDownloadItems}
                  onSetDownloadScope={handleSetDownloadScope}
                  onRefresh={refreshDownloadQueue}
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

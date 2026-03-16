import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, History, Search, ArrowLeft } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useApiFetcher } from "../hooks/useApiFetcher";
import {
  MovieHubService,
  MovieHubYtDownloadRequest,
  MovieHubYtFormatsResponse,
  MovieHubYtLibraryItem,
  MovieHubYtRequestFormat,
} from "../apis/moviehub/moviehub";
import { Loader } from "./Loader";
import { useNotification } from "../context/NotificationContext";
import { YtDownloadComposer } from "./moviehub/yt/YtDownloadComposer";
import { YtCurrentDownloadingStatusPanel } from "./moviehub/yt/YtCurrentDownloadingStatusPanel";
import { YtLibraryItemsTable } from "./moviehub/yt/YtLibraryItemsTable";
import { YtDownloadRequestsTable } from "./moviehub/yt/YtDownloadRequestsTable";

type YtWorkspaceSection =
  | "search_download"
  | "view_downloaded"
  | "request_history";

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

const ytSectionItems: Array<{
  id: YtWorkspaceSection;
  label: string;
  compactLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: "search_download",
    label: "Search and Download",
    compactLabel: "SD",
    icon: Search,
  },
  {
    id: "view_downloaded",
    label: "View Downloaded",
    compactLabel: "VD",
    icon: Download,
  },
  {
    id: "request_history",
    label: "Request History",
    compactLabel: "RH",
    icon: History,
  },
];

export const MovieHubYtPage: React.FC = () => {
  const navigate = useNavigate();
  const { authToken, isAuthLoading, user } = useAuth();
  const { addNotification } = useNotification();
  const isAdmin = user?.role === "ADMIN";

  const [activeSection, setActiveSection] =
    useState<YtWorkspaceSection>("search_download");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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
    data: deleteYtLibraryData,
    fetchData: fetchDeleteYtLibraryItem,
  } = useApiFetcher();
  const {
    data: deleteYtRequestData,
    fetchData: fetchDeleteYtRequest,
  } = useApiFetcher();

  const isUnauthenticated = !isAuthLoading && !authToken;

  useEffect(() => {
    if (isUnauthenticated) {
      navigate("/login", { state: { from: "/moviehub/yt" } });
    }
  }, [isUnauthenticated, navigate]);

  useEffect(() => {
    if (isAuthLoading || !authToken) return;
    if (!isAdmin) {
      navigate("/moviehub");
    }
  }, [isAuthLoading, authToken, isAdmin, navigate]);

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

  useEffect(() => {
    if (activeSection === "search_download" || activeSection === "request_history") {
      loadYtDownloadRequests();
    }
  }, [activeSection, loadYtDownloadRequests]);

  useEffect(() => {
    if (activeSection === "view_downloaded") {
      loadYtLibraryItems();
    }
  }, [activeSection, loadYtLibraryItems]);

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
    if (activeSection !== "search_download") return;
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
  }, [activeSection, ytDownloadRequests, streamDownloadingStatus]);

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

  const activeSectionMeta = useMemo(
    () => ytSectionItems.find((item) => item.id === activeSection),
    [activeSection],
  );

  if (isAuthLoading || isUnauthenticated) {
    return <Loader />;
  }

  if (!isAdmin) {
    return <Loader />;
  }

  return (
    <div className="min-h-screen w-full moviehub-bg pt-[calc(5rem+env(safe-area-inset-top))] sm:pt-24 pb-8 sm:pb-12 px-4 overflow-x-hidden">
      <div className="max-w-7xl mx-auto">
        <div
          className={`grid grid-cols-1 gap-4 md:gap-6 md:items-start ${
            isSidebarCollapsed
              ? "md:grid-cols-[72px_minmax(0,1fr)]"
              : "md:grid-cols-[300px_minmax(0,1fr)]"
          }`}
        >
          <aside className="hidden md:flex md:flex-col self-start moviehub-panel rounded-2xl p-2.5 h-fit max-h-[calc(100vh-7rem)] overflow-y-auto transition-all duration-300">
            <div
              className={`mb-4 flex items-center ${
                isSidebarCollapsed ? "justify-center" : "justify-between"
              }`}
            >
              {!isSidebarCollapsed && (
                <div>
                  <p className="text-lg font-extrabold text-gray-900 dark:text-white">
                    YT Console
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Admin workspace
                  </p>
                </div>
              )}
              <button
                onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 dark:bg-slate-800 text-blue-700 dark:text-blue-300"
                title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {isSidebarCollapsed ? ">>" : "<<"}
              </button>
            </div>
              <button
                onClick={() => navigate("/moviehub")}
                className={`mb-2 rounded-xl px-2.5 py-2 text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 flex items-center gap-2 ${
                  isSidebarCollapsed ? "justify-center" : ""
                }`}
                title="Back to MovieHub"
            >
              <ArrowLeft className="w-4 h-4" />
              {!isSidebarCollapsed && <span>Back to MovieHub</span>}
            </button>
            <nav className={`flex flex-col gap-2 ${isSidebarCollapsed ? "" : "pr-1"}`}>
              {ytSectionItems.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`group relative w-full rounded-xl text-sm font-semibold transition-all duration-200 ${
                      isActive
                        ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-500/20"
                        : "text-gray-700 dark:text-gray-300 hover:bg-white/60 dark:hover:bg-slate-800/70"
                    } ${
                      isSidebarCollapsed
                        ? "px-1.5 py-2 flex items-center justify-center"
                        : "px-2.5 py-2 flex items-center gap-3 text-left"
                    }`}
                    title={section.label}
                  >
                    <span className="inline-flex items-center justify-center rounded-md border border-current/25 w-8 h-8">
                      <Icon className="w-4 h-4" />
                    </span>
                    {!isSidebarCollapsed && (
                      <span className="truncate">{section.label}</span>
                    )}
                    {isActive && !isSidebarCollapsed && (
                      <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-white/80" />
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>

          <section className="min-w-0 space-y-4">
            <div className="md:hidden moviehub-panel rounded-2xl p-2.5 space-y-2.5">
              <button
                onClick={() => navigate("/moviehub")}
                className="w-full rounded-xl px-2.5 py-2 text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to MovieHub</span>
              </button>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {ytSectionItems.map((section) => {
                  const Icon = section.icon;
                  const isActive = activeSection === section.id;
                  return (
                    <button
                      key={`mobile-${section.id}`}
                      onClick={() => setActiveSection(section.id)}
                      className={`shrink-0 rounded-xl px-2.5 py-1.5 text-sm font-semibold flex items-center gap-2 ${
                        isActive
                          ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white"
                          : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{section.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="moviehub-panel rounded-2xl p-3 sm:p-4 min-h-[520px] overflow-x-hidden relative">
              <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/70 to-transparent" />
              <div className="mb-5">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-600 dark:text-blue-300">
                  MovieHub / YouTube
                </p>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {activeSectionMeta?.label || "YT Console"}
                </h1>
              </div>

              {activeSection === "search_download" && (
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
                  <div className="xl:col-span-8">
                    <YtDownloadComposer
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
                      onYtUrlChange={setYtUrl}
                      onFilenameChange={setYtFilename}
                      onPassDownloadPathChange={handlePassDownloadPathChange}
                      onDownloadPathChange={setYtDownloadPath}
                      onSongChange={handleSongModeChange}
                      onFetchFormats={handleFetchYtFormats}
                      onClearSearch={handleClearYtSearch}
                      onFormatChange={setSelectedYtFormat}
                      onDownloadToServer={handleDownloadYtToServer}
                    />
                  </div>
                  <div className="xl:col-span-4">
                    <YtCurrentDownloadingStatusPanel
                      ytRequests={ytDownloadRequests}
                      ytStatusByVideoId={ytStatusByVideoId}
                      formatDateTime={formatDateTime}
                    />
                  </div>
                </div>
              )}

              {activeSection === "view_downloaded" && (
                <YtLibraryItemsTable
                  ytLibraryLoading={ytLibraryLoading}
                  ytLibraryItems={ytLibraryItems}
                  deletingItemId={deletingYtLibraryItemId}
                  onRefreshItems={loadYtLibraryItems}
                  onDeleteItem={handleDeleteYtLibraryItem}
                />
              )}

              {activeSection === "request_history" && (
                <YtDownloadRequestsTable
                  ytRequestsLoading={ytRequestsLoading}
                  ytRequests={ytDownloadRequests}
                  formatDateTime={formatDateTime}
                  onRefreshRequests={loadYtDownloadRequests}
                  deletingRequestId={deletingYtRequestId}
                  onDeleteRequest={handleDeleteYtRequest}
                />
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default MovieHubYtPage;

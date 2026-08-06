import React, { useState } from "react";
import { Download, History, Library, ShieldCheck } from "lucide-react";
import {
  MovieHubYtDownloadRequest,
  MovieHubYtFormatsResponse,
  MovieHubYtLibraryItem,
  MovieHubYtRequestFormat,
} from "../../apis/moviehub/moviehub";
import { YtDownloadComposer } from "./yt/YtDownloadComposer";
import { YtCurrentDownloadingStatusPanel } from "./yt/YtCurrentDownloadingStatusPanel";
import { YtDownloadRequestsTable } from "./yt/YtDownloadRequestsTable";
import { YtLibraryItemsTable } from "./yt/YtLibraryItemsTable";

type MovieHubYtAdminSectionProps = {
  ytUrl: string;
  filename: string;
  passDownloadPath: boolean;
  downloadPath: string;
  isSong: boolean;
  formatsLoading: boolean;
  downloadInProgress: boolean;
  formatsResponse: MovieHubYtFormatsResponse | null;
  selectedFormat: MovieHubYtRequestFormat | null;
  downloadError: string | null;
  ytRequestsLoading: boolean;
  ytRequests: MovieHubYtDownloadRequest[];
  ytStatusByVideoId: Record<string, Record<string, unknown>>;
  ytLibraryLoading: boolean;
  ytLibraryItems: MovieHubYtLibraryItem[];
  deletingYtRequestId: string | null;
  deletingYtLibraryItemId: string | null;
  formatDateTime: (value?: string) => string;
  onYtUrlChange: (value: string) => void;
  onFilenameChange: (value: string) => void;
  onPassDownloadPathChange: (value: boolean) => void;
  onDownloadPathChange: (value: string) => void;
  onSongChange: (value: boolean) => void;
  onFetchFormats: () => void;
  onClearSearch: () => void;
  onFormatChange: (format: MovieHubYtRequestFormat) => void;
  onDownloadToServer: () => void;
  onRefreshRequests: () => void;
  onDeleteRequest: (requestId: string) => void;
  onRefreshLibraryItems: () => void;
  onDeleteLibraryItem: (itemId: string) => void;
};

export const MovieHubYtAdminSection: React.FC<MovieHubYtAdminSectionProps> =
  React.memo(
    ({
      ytUrl,
      filename,
      passDownloadPath,
      downloadPath,
      isSong,
      formatsLoading,
      downloadInProgress,
      formatsResponse,
      selectedFormat,
      downloadError,
      ytRequestsLoading,
      ytRequests,
      ytStatusByVideoId,
      ytLibraryLoading,
      ytLibraryItems,
      deletingYtRequestId,
      deletingYtLibraryItemId,
      formatDateTime,
      onYtUrlChange,
      onFilenameChange,
      onPassDownloadPathChange,
      onDownloadPathChange,
      onSongChange,
      onFetchFormats,
      onClearSearch,
      onFormatChange,
      onDownloadToServer,
      onRefreshRequests,
      onDeleteRequest,
      onRefreshLibraryItems,
      onDeleteLibraryItem,
    }) => {
      const [activeView, setActiveView] = useState<
        "download" | "history" | "library"
      >("download");

      return (
        <div className="space-y-6">
          <div className="moviehub-admin-workspace-header">
            <div>
              <span className="moviehub-admin-kicker">
                <ShieldCheck className="h-3.5 w-3.5" />
                Admin Studio
              </span>
              <h2>YouTube Library</h2>
              <p>Bring videos into MovieHub and manage the server library.</p>
            </div>
            <div className="moviehub-yt-tabs">
              {[
                { id: "download" as const, label: "Download", icon: Download },
                { id: "history" as const, label: "History", icon: History },
                { id: "library" as const, label: "Library", icon: Library },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveView(id)}
                  className={activeView === id ? "moviehub-yt-tab-active" : ""}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {activeView === "download" && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
              <div className="xl:col-span-8">
                <YtDownloadComposer
                  ytUrl={ytUrl}
                  filename={filename}
                  passDownloadPath={passDownloadPath}
                  downloadPath={downloadPath}
                  isSong={isSong}
                  formatsLoading={formatsLoading}
                  downloadInProgress={downloadInProgress}
                  formatsResponse={formatsResponse}
                  selectedFormat={selectedFormat}
                  downloadError={downloadError}
                  onYtUrlChange={onYtUrlChange}
                  onFilenameChange={onFilenameChange}
                  onPassDownloadPathChange={onPassDownloadPathChange}
                  onDownloadPathChange={onDownloadPathChange}
                  onSongChange={onSongChange}
                  onFetchFormats={onFetchFormats}
                  onClearSearch={onClearSearch}
                  onFormatChange={onFormatChange}
                  onDownloadToServer={onDownloadToServer}
                />
              </div>
              <div className="xl:col-span-4">
                <YtCurrentDownloadingStatusPanel
                  ytRequests={ytRequests}
                  ytStatusByVideoId={ytStatusByVideoId}
                  formatDateTime={formatDateTime}
                />
              </div>
            </div>
          )}

          {activeView === "history" && (
            <YtDownloadRequestsTable
              ytRequestsLoading={ytRequestsLoading}
              ytRequests={ytRequests}
              formatDateTime={formatDateTime}
              onRefreshRequests={onRefreshRequests}
              deletingRequestId={deletingYtRequestId}
              onDeleteRequest={onDeleteRequest}
            />
          )}

          {activeView === "library" && (
            <YtLibraryItemsTable
              ytLibraryLoading={ytLibraryLoading}
              ytLibraryItems={ytLibraryItems}
              deletingItemId={deletingYtLibraryItemId}
              onRefreshItems={onRefreshLibraryItems}
              onDeleteItem={onDeleteLibraryItem}
            />
          )}
        </div>
      );
    },
  );

MovieHubYtAdminSection.displayName = "MovieHubYtAdminSection";

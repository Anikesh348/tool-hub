import React from "react";
import {
  MovieHubYtDownloadRequest,
  MovieHubYtFormatsResponse,
  MovieHubYtRequestFormat,
} from "../../apis/moviehub/moviehub";
import { YtDownloadComposer } from "./yt/YtDownloadComposer";
import { YtCurrentDownloadingStatusPanel } from "./yt/YtCurrentDownloadingStatusPanel";
import { YtDownloadRequestsTable } from "./yt/YtDownloadRequestsTable";

type MovieHubYtAdminSectionProps = {
  ytUrl: string;
  filename: string;
  formatsLoading: boolean;
  downloadInProgress: boolean;
  formatsResponse: MovieHubYtFormatsResponse | null;
  selectedFormat: MovieHubYtRequestFormat | null;
  downloadError: string | null;
  ytRequestsLoading: boolean;
  ytRequests: MovieHubYtDownloadRequest[];
  ytStatusByVideoId: Record<string, Record<string, unknown>>;
  formatDateTime: (value?: string) => string;
  onYtUrlChange: (value: string) => void;
  onFilenameChange: (value: string) => void;
  onFetchFormats: () => void;
  onClearSearch: () => void;
  onFormatChange: (format: MovieHubYtRequestFormat) => void;
  onDownloadToServer: () => void;
  onRefreshRequests: () => void;
};

export const MovieHubYtAdminSection: React.FC<MovieHubYtAdminSectionProps> =
  React.memo(
    ({
      ytUrl,
      filename,
      formatsLoading,
      downloadInProgress,
      formatsResponse,
      selectedFormat,
      downloadError,
      ytRequestsLoading,
      ytRequests,
      ytStatusByVideoId,
      formatDateTime,
      onYtUrlChange,
      onFilenameChange,
      onFetchFormats,
      onClearSearch,
      onFormatChange,
      onDownloadToServer,
      onRefreshRequests,
    }) => {
      return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              YouTube Download Console
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              Queue YouTube videos to download directly to the MovieHub server and monitor active request status.
            </p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
            <div className="xl:col-span-8">
              <YtDownloadComposer
                ytUrl={ytUrl}
                filename={filename}
                formatsLoading={formatsLoading}
                downloadInProgress={downloadInProgress}
                formatsResponse={formatsResponse}
                selectedFormat={selectedFormat}
                downloadError={downloadError}
                onYtUrlChange={onYtUrlChange}
                onFilenameChange={onFilenameChange}
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

          <YtDownloadRequestsTable
            ytRequestsLoading={ytRequestsLoading}
            ytRequests={ytRequests}
            formatDateTime={formatDateTime}
            onRefreshRequests={onRefreshRequests}
          />
        </div>
      );
    },
  );

MovieHubYtAdminSection.displayName = "MovieHubYtAdminSection";

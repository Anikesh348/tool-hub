import React, { useEffect, useState } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { getAdminTool } from "../adminTools";
import { useAuth } from "../context/AuthContext";
import FileManager from "./FileManager";
import SystemMetrics from "./SystemMetrics";
import UptimeMonitor from "./UptimeMonitor";

export const AdminToolFrame = () => {
  const { toolKey } = useParams();
  const location = useLocation();
  const tool = getAdminTool(toolKey);
  const { authToken } = useAuth();
  const [frameKey, setFrameKey] = useState(0);
  const [proxyReady, setProxyReady] = useState(false);

  useEffect(() => {
    setProxyReady(Boolean(authToken));
  }, [authToken]);

  if (!tool) {
    return <Navigate to="/" replace />;
  }

  const Icon = tool.icon;
  const isSystemMetrics = tool.key === "system-metrics";
  const isFileManager = tool.key === "filemanager";
  const isUptimeMonitor = tool.key === "uptime-monitor";
  const requestedPanel = new URLSearchParams(location.search).get("panel");
  const frameHash =
    tool.key === "jellyfin-control" &&
    (requestedPanel === "queue" || requestedPanel === "logs")
      ? `#${requestedPanel}`
      : "";
  const frameSrc = `${tool.proxyPath}${frameHash}`;

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden pt-16">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.07] bg-[#070b13] px-4 sm:px-6">
        <span className={`tool-card-icon tool-card-icon-${tool.tone} !h-8 !w-8`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-bold text-white">
              {tool.title}
            </h1>
            <ShieldCheck className="h-3.5 w-3.5 text-amber-300" />
          </div>
          <p className="truncate text-[10px] text-slate-500">
            {tool.description}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFrameKey((value) => value + 1)}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-violet-400/50 hover:text-white"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Reload
        </button>
      </div>
      {proxyReady ? (
        isSystemMetrics ? (
          <SystemMetrics key={frameKey} />
        ) : isFileManager ? (
          <FileManager key={frameKey} />
        ) : isUptimeMonitor ? (
          <UptimeMonitor key={frameKey} />
        ) : (
          <iframe
            key={frameKey}
            src={frameSrc}
            title={tool.title}
            className="min-h-0 flex-1 border-0 bg-white"
            allow="clipboard-read; clipboard-write; fullscreen"
          />
        )
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-500">
          Preparing secure admin access...
        </div>
      )}
    </div>
  );
};

export default AdminToolFrame;

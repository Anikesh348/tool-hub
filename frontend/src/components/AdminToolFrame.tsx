import React, { useEffect, useState } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { getAdminTool } from "../adminTools";
import { useAuth } from "../context/AuthContext";
import LogDigest from "./LogDigest";
import SystemMetrics from "./SystemMetrics";
import UptimeMonitor from "./UptimeMonitor";

const mediaServices = [
  {
    key: "radarr",
    label: "Radarr",
    proxyPath: "/admin-proxy/media/radarr/",
  },
  {
    key: "sonarr",
    label: "Sonarr",
    proxyPath: "/admin-proxy/media/sonarr/",
  },
  {
    key: "prowlarr",
    label: "Prowlarr",
    proxyPath: "/admin-proxy/media/prowlarr/",
  },
  {
    key: "qbittorrent",
    label: "qBittorrent",
    proxyPath: "/admin-proxy/media/qbittorrent/",
  },
] as const;

type MediaServiceKey = (typeof mediaServices)[number]["key"];

const getMediaService = (value: string | null) =>
  mediaServices.find((service) => service.key === value) ?? mediaServices[0];

export const AdminToolFrame = () => {
  const { toolKey } = useParams();
  const location = useLocation();
  const tool = getAdminTool(toolKey);
  const { authToken } = useAuth();
  const [frameKey, setFrameKey] = useState(0);
  const [proxyReady, setProxyReady] = useState(false);
  const [dockerHost, setDockerHost] = useState<"pi5" | "ubuntu">(() =>
    new URLSearchParams(window.location.search).get("dockerHost") === "ubuntu"
      ? "ubuntu"
      : "pi5",
  );
  const [mediaServiceKey, setMediaServiceKey] = useState<MediaServiceKey>(
    () =>
      getMediaService(new URLSearchParams(window.location.search).get("service"))
        .key,
  );

  useEffect(() => {
    setProxyReady(Boolean(authToken));
  }, [authToken]);

  if (!tool) {
    return <Navigate to="/" replace />;
  }

  const Icon = tool.icon;
  const isSystemMetrics = tool.key === "system-metrics";
  const isLogDigest = tool.key === "log-digest";
  const isUptimeMonitor = tool.key === "uptime-monitor";
  const isDockerManager = tool.key === "docker-manager";
  const isMediaConsole = tool.key === "media-console";
  const mediaService = getMediaService(mediaServiceKey);
  const requestedPanel = new URLSearchParams(location.search).get("panel");
  const frameHash =
    tool.key === "jellyfin-control" &&
    (requestedPanel === "queue" || requestedPanel === "logs")
      ? `#${requestedPanel}`
      : "";
  const dockerProxyPath =
    dockerHost === "ubuntu"
      ? "/admin-proxy/docker-manager-ubuntu/"
      : "/admin-proxy/docker-manager/";
  const frameBase = isDockerManager
    ? dockerProxyPath
    : isMediaConsole
      ? mediaService.proxyPath
      : tool.proxyPath;
  const frameQuerySeparator = frameBase.includes("?") ? "&" : "?";
  // A distinct URL is important here: Chromium can retain a previously
  // rejected iframe document after its framing policy has been corrected.
  // It also makes the Reload button perform a real network navigation.
  const frameSrc = `${frameBase}${frameQuerySeparator}toolhubFrame=${frameKey}${frameHash}`;

  const selectDockerHost = (host: "pi5" | "ubuntu") => {
    if (host === dockerHost) return;
    const url = new URL(window.location.href);
    url.searchParams.set("dockerHost", host);
    window.history.replaceState({}, "", url);
    setDockerHost(host);
    setFrameKey((value) => value + 1);
  };

  const selectMediaService = (serviceKey: MediaServiceKey) => {
    if (serviceKey === mediaServiceKey) return;
    const url = new URL(window.location.href);
    url.searchParams.set("service", serviceKey);
    window.history.replaceState({}, "", url);
    setMediaServiceKey(serviceKey);
    setFrameKey((value) => value + 1);
  };

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
        {isDockerManager ? (
          <div className="flex items-center rounded-lg border border-white/10 bg-black/20 p-1">
            {([
              ["pi5", "Pi 5"],
              ["ubuntu", "Ubuntu"],
            ] as const).map(([host, label]) => (
              <button
                key={host}
                type="button"
                onClick={() => selectDockerHost(host)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  dockerHost === host
                    ? "bg-violet-500/25 text-violet-100"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {isMediaConsole ? (
          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1">
            <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-slate-500 sm:inline">
              Service
            </span>
            <select
              value={mediaServiceKey}
              onChange={(event) =>
                selectMediaService(event.target.value as MediaServiceKey)
              }
              aria-label="Media service"
              className="min-w-0 bg-transparent py-1 text-xs font-semibold text-violet-100 outline-none"
            >
              {mediaServices.map((service) => (
                <option
                  key={service.key}
                  value={service.key}
                  className="bg-slate-950 text-white"
                >
                  {service.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
        ) : isLogDigest ? (
          <LogDigest key={frameKey} />
        ) : isUptimeMonitor ? (
          <UptimeMonitor key={frameKey} />
        ) : (
          <iframe
            key={frameKey}
            src={frameSrc}
            onLoad={(event) => {
              if (!isMediaConsole || mediaService.key !== "qbittorrent") return;

              const frameWindow = event.currentTarget.contentWindow;
              if (!frameWindow) return;

              const refreshEmbeddedLayout = () => {
                frameWindow.dispatchEvent(new frameWindow.Event("resize"));
              };

              frameWindow.requestAnimationFrame(refreshEmbeddedLayout);
              window.setTimeout(refreshEmbeddedLayout, 250);
              window.setTimeout(refreshEmbeddedLayout, 1000);
            }}
            title={
              isMediaConsole
                ? `${mediaService.label} | ${tool.title}`
                : tool.title
            }
            className="min-h-0 min-w-0 w-full flex-1 basis-0 border-0 bg-white"
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

import {
  Activity,
  Bot,
  Container,
  Film,
  Gauge,
  HeartPulse,
  ScrollText,
  ServerCog,
  type LucideIcon,
} from "lucide-react";

export interface AdminTool {
  key: string;
  path: string;
  proxyPath: string;
  title: string;
  description: string;
  icon: LucideIcon;
  tone: "violet" | "blue" | "amber";
}

export const adminTools: AdminTool[] = [
  {
    key: "ai-assistant",
    path: "/admin/ai",
    proxyPath: "",
    title: "AI Assistant",
    description: "Chat with the private Codex intelligence layer",
    icon: Bot,
    tone: "violet",
  },
  {
    key: "log-digest",
    path: "/admin/tools/log-digest",
    proxyPath: "",
    title: "Daily Log Digest",
    description: "Review important Ubuntu and Home Assistant log events",
    icon: ScrollText,
    tone: "amber",
  },
  {
    key: "system-metrics",
    path: "/admin/tools/system-metrics",
    proxyPath: "/admin-proxy/system-metrics/",
    title: "System Metrics",
    description: "Monitor critical Pi health and performance",
    icon: Gauge,
    tone: "violet",
  },
  {
    key: "beszel",
    path: "/admin/tools/beszel",
    proxyPath: "/admin-proxy/beszel/",
    title: "Beszel Monitoring",
    description: "Monitor Proxmox, Home Assistant, and the Codex VM",
    icon: Activity,
    tone: "blue",
  },
  {
    key: "api-route-analytics",
    path: "/admin/tools/api-route-analytics",
    proxyPath:
      "/admin-proxy/route-analytics/d/toolhub-route-analytics/tool-hub-api-route-analytics?orgId=1&kiosk",
    title: "API Route Analytics",
    description: "Inspect request counts, latency, traffic, and errors",
    icon: Activity,
    tone: "blue",
  },
  {
    key: "uptime-monitor",
    path: "/admin/tools/uptime-monitor",
    proxyPath: "/admin-proxy/uptime/",
    title: "API Uptime",
    description: "Review availability and response time across the Pi",
    icon: HeartPulse,
    tone: "amber",
  },
  {
    key: "docker-manager",
    path: "/admin/tools/docker-manager",
    proxyPath: "/admin-proxy/docker-manager/",
    title: "Docker Fleet",
    description: "View logs and manage containers across every host",
    icon: Container,
    tone: "violet",
  },
  {
    key: "ai-toolhub",
    path: "/admin/tools/ai-toolhub",
    proxyPath: "/admin-proxy/ai-toolhub/",
    title: "AI Toolhub",
    description: "Build and manage AI tools",
    icon: Bot,
    tone: "amber",
  },
  {
    key: "media-console",
    path: "/admin/tools/media-console",
    proxyPath: "",
    title: "Media Console",
    description: "Manage Radarr, Sonarr, Prowlarr, and qBittorrent",
    icon: Film,
    tone: "blue",
  },
  {
    key: "jellyfin-control",
    path: "/admin/tools/jellyfin-control",
    proxyPath: "/admin-proxy/jellyfin-control/",
    title: "Jellyfin Control",
    description: "Administer the media server",
    icon: ServerCog,
    tone: "violet",
  },
];

export const getAdminTool = (key: string | undefined) =>
  adminTools.find((tool) => tool.key === key);

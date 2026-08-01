import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Info,
  Megaphone,
  RefreshCw,
  Send,
  ShieldAlert,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  NotificationService,
  type PublishNotificationPayload,
  type SiteNotification,
  type SiteNotificationSeverity,
} from "../apis/notifications/notifications";
import { useAuth } from "../context/AuthContext";
import { useNotification } from "../context/NotificationContext";


const severityTone: Record<SiteNotificationSeverity, string> = {
  INFO: "border-sky-400/25 bg-sky-400/10 text-sky-300",
  SUCCESS: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  WARNING: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  ERROR: "border-rose-400/25 bg-rose-400/10 text-rose-300",
  CRITICAL: "border-red-400/35 bg-red-500/15 text-red-200",
};

const toastType = (severity: SiteNotificationSeverity) => {
  if (severity === "SUCCESS") return "success" as const;
  if (severity === "WARNING") return "warning" as const;
  if (severity === "ERROR" || severity === "CRITICAL") return "error" as const;
  return "info" as const;
};

const initialComposer: PublishNotificationPayload = {
  audience: "ADMIN",
  title: "",
  message: "",
  severity: "INFO",
  category: "general",
  targetEmail: "",
  actionUrl: "",
  source: "manual",
};

function relativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(value).toLocaleDateString();
}

function SeverityIcon({ severity }: { severity: SiteNotificationSeverity }) {
  if (severity === "WARNING") return <AlertTriangle className="h-4 w-4" />;
  if (severity === "ERROR" || severity === "CRITICAL") {
    return <ShieldAlert className="h-4 w-4" />;
  }
  if (severity === "SUCCESS") return <CheckCheck className="h-4 w-4" />;
  return <Info className="h-4 w-4" />;
}

export default function GlobalNotifications() {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { addNotification } = useNotification();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SiteNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [composer, setComposer] = useState<PublishNotificationPayload>(initialComposer);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const knownIdsRef = useRef<Set<string> | null>(null);
  const isAdmin = user?.role === "ADMIN";

  const loadNotifications = useCallback(
    async (showLoading = false) => {
      if (!isAuthenticated) return;
      if (showLoading) setLoading(true);
      try {
        const feed = await NotificationService.list();
        if (knownIdsRef.current) {
          const newlyArrived = feed.notifications.filter(
            (item) => !item.read && !knownIdsRef.current?.has(item.notificationId),
          );
          newlyArrived.slice(0, 3).forEach((item) => {
            addNotification(`${item.title}: ${item.message}`, toastType(item.severity), 7000);
          });
        }
        knownIdsRef.current = new Set(feed.notifications.map((item) => item.notificationId));
        setItems(feed.notifications);
        setUnreadCount(feed.unreadCount);
      } catch (error) {
        if (showLoading) {
          addNotification(
            error instanceof Error ? error.message : "Could not load notifications",
            "error",
          );
        }
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [addNotification, isAuthenticated],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      setItems([]);
      setUnreadCount(0);
      knownIdsRef.current = null;
      return;
    }
    loadNotifications();
    const interval = window.setInterval(() => loadNotifications(), 20_000);
    return () => window.clearInterval(interval);
  }, [isAuthenticated, loadNotifications]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const markRead = async (notification: SiteNotification) => {
    if (!notification.read) {
      setItems((current) =>
        current.map((item) =>
          item.notificationId === notification.notificationId
            ? { ...item, read: true }
            : item,
        ),
      );
      setUnreadCount((count) => Math.max(0, count - 1));
      try {
        await NotificationService.markRead(notification.notificationId);
      } catch {
        loadNotifications();
      }
    }
    if (notification.actionUrl) {
      setOpen(false);
      if (/^https?:\/\//i.test(notification.actionUrl)) {
        window.location.assign(notification.actionUrl);
      } else {
        navigate(notification.actionUrl);
      }
    }
  };

  const markAllRead = async () => {
    setItems((current) => current.map((item) => ({ ...item, read: true })));
    setUnreadCount(0);
    try {
      await NotificationService.markAllRead();
    } catch (error) {
      addNotification(
        error instanceof Error ? error.message : "Could not mark notifications read",
        "error",
      );
      loadNotifications();
    }
  };

  const publishAlert = async (event: React.FormEvent) => {
    event.preventDefault();
    setPublishing(true);
    try {
      await NotificationService.publish({
        ...composer,
        targetEmail: composer.audience === "USER" ? composer.targetEmail : "",
      });
      addNotification("Alert published.", "success", 3000);
      setComposer(initialComposer);
      setShowComposer(false);
      await loadNotifications();
    } catch (error) {
      addNotification(
        error instanceof Error ? error.message : "Could not publish alert",
        "error",
      );
    } finally {
      setPublishing(false);
    }
  };

  if (!isAuthenticated) return null;
  const visibleItems = showUnreadOnly ? items.filter((item) => !item.read) : items;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          if (!open) loadNotifications();
        }}
        className="relative rounded-lg border border-white/10 bg-white/[0.035] p-2 text-slate-300 transition hover:border-violet-400/35 hover:bg-violet-500/10 hover:text-white"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white shadow-lg shadow-rose-950/40">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <section className="fixed inset-x-3 top-[4.5rem] z-50 flex max-h-[calc(100vh-5.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#080d17]/[0.98] shadow-2xl shadow-black/50 backdrop-blur-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+10px)] sm:h-[min(680px,calc(100vh-90px))] sm:w-[430px]">
          <header className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
              <Bell className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-white">Notifications</h2>
              <p className="text-[10px] text-slate-500">{unreadCount} unread · updates every 20 seconds</p>
            </div>
            <button
              type="button"
              onClick={() => loadNotifications(true)}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.06] hover:text-white"
              aria-label="Refresh notifications"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-white/[0.06] hover:text-white sm:hidden"
              aria-label="Close notifications"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-2.5">
            <button
              type="button"
              onClick={() => setShowUnreadOnly(false)}
              className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${!showUnreadOnly ? "bg-violet-500/15 text-violet-200" : "text-slate-500 hover:text-white"}`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setShowUnreadOnly(true)}
              className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${showUnreadOnly ? "bg-violet-500/15 text-violet-200" : "text-slate-500 hover:text-white"}`}
            >
              Unread
            </button>
            <div className="ml-auto flex items-center gap-1">
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowComposer((value) => !value)}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-amber-300 transition hover:bg-amber-400/10"
                >
                  <Megaphone className="h-3.5 w-3.5" />
                  Push alert
                </button>
              )}
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-slate-400 transition hover:bg-white/[0.05] hover:text-white"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Read all
                </button>
              )}
            </div>
          </div>

          {showComposer && isAdmin && (
            <form onSubmit={publishAlert} className="space-y-2 border-b border-amber-400/15 bg-amber-400/[0.035] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-200">
                <Send className="h-3.5 w-3.5" /> Publish an alert
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={composer.audience}
                  onChange={(event) => setComposer((value) => ({ ...value, audience: event.target.value as "ADMIN" | "USER" }))}
                  className="rounded-lg border border-white/10 bg-[#0c1320] px-2.5 py-2 text-xs text-slate-200 outline-none"
                >
                  <option value="ADMIN">Admin alert</option>
                  <option value="USER">User alert</option>
                </select>
                <select
                  value={composer.severity}
                  onChange={(event) => setComposer((value) => ({ ...value, severity: event.target.value as SiteNotificationSeverity }))}
                  className="rounded-lg border border-white/10 bg-[#0c1320] px-2.5 py-2 text-xs text-slate-200 outline-none"
                >
                  {(["INFO", "SUCCESS", "WARNING", "ERROR", "CRITICAL"] as const).map((severity) => (
                    <option key={severity} value={severity}>{severity}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={composer.category}
                  onChange={(event) => setComposer((value) => ({ ...value, category: event.target.value }))}
                  className="rounded-lg border border-white/10 bg-[#0c1320] px-2.5 py-2 text-xs text-slate-200 outline-none"
                >
                  {[
                    "general", "home", "security", "infrastructure", "service",
                    "storage", "backup", "media", "access", "deployment",
                  ].map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
                <input
                  value={composer.actionUrl}
                  onChange={(event) => setComposer((value) => ({ ...value, actionUrl: event.target.value }))}
                  placeholder="Action URL (optional)"
                  className="rounded-lg border border-white/10 bg-[#0c1320] px-2.5 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600"
                />
              </div>
              {composer.audience === "USER" && (
                <input
                  type="email"
                  value={composer.targetEmail}
                  onChange={(event) => setComposer((value) => ({ ...value, targetEmail: event.target.value }))}
                  placeholder="User email (blank sends to every user)"
                  className="w-full rounded-lg border border-white/10 bg-[#0c1320] px-2.5 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600"
                />
              )}
              <input
                required
                maxLength={140}
                value={composer.title}
                onChange={(event) => setComposer((value) => ({ ...value, title: event.target.value }))}
                placeholder="Alert title"
                className="w-full rounded-lg border border-white/10 bg-[#0c1320] px-2.5 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600"
              />
              <textarea
                required
                maxLength={2000}
                rows={3}
                value={composer.message}
                onChange={(event) => setComposer((value) => ({ ...value, message: event.target.value }))}
                placeholder="What happened and what should the recipient know?"
                className="w-full resize-none rounded-lg border border-white/10 bg-[#0c1320] px-2.5 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowComposer(false)} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:text-white">Cancel</button>
                <button disabled={publishing} className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-50">
                  {publishing ? "Publishing…" : "Publish"}
                </button>
              </div>
            </form>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {visibleItems.length ? (
              visibleItems.map((item) => (
                <button
                  key={item.notificationId}
                  type="button"
                  onClick={() => markRead(item)}
                  className={`group flex w-full items-start gap-3 border-b border-white/[0.055] px-4 py-3.5 text-left transition hover:bg-white/[0.035] ${item.read ? "opacity-65" : "bg-white/[0.018]"}`}
                >
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${severityTone[item.severity]}`}>
                    <SeverityIcon severity={item.severity} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white">{item.title}</span>
                      {!item.read && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />}
                    </span>
                    <span className="mt-1 block text-[11px] leading-4 text-slate-400">{item.message}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-slate-600">
                      <span className={item.audience === "ADMIN" ? "text-amber-400" : "text-sky-400"}>{item.audience}</span>
                      <span>·</span>
                      <span>{item.category.replaceAll("_", " ")}</span>
                      <span>·</span>
                      <span>{relativeTime(item.createdAt)}</span>
                    </span>
                  </span>
                  {item.actionUrl && <ChevronRight className="mt-2 h-3.5 w-3.5 shrink-0 text-slate-700 transition group-hover:text-violet-300" />}
                </button>
              ))
            ) : (
              <div className="flex h-52 flex-col items-center justify-center px-8 text-center">
                <CircleAlert className="h-6 w-6 text-slate-700" />
                <p className="mt-3 text-xs font-semibold text-slate-400">{showUnreadOnly ? "You’re all caught up" : "No notifications yet"}</p>
                <p className="mt-1 text-[10px] leading-4 text-slate-600">System, home and MovieHub activity will appear here.</p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { sendActivityEvents, sendHeartbeat, type ActivityEvent } from "../apis/activity/activity";

const SESSION_KEY = "toolhub_activity_session";
const FLUSH_INTERVAL_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const SCROLL_CHECKPOINTS = [25, 50, 75, 100];

const getSessionId = (): string => {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
};

// Nearest interactive ancestor, so a click on an icon inside a button is
// attributed to the button rather than the icon's bare <svg>/<path> tag.
const describeTarget = (el: EventTarget | null): string => {
  if (!(el instanceof Element)) return "unknown";
  const clickable = el.closest("button, a, [role='button'], [data-track]") || el;
  const tag = clickable.tagName.toLowerCase();
  const id = clickable.id ? `#${clickable.id}` : "";
  const cls = clickable.classList[0] ? `.${clickable.classList[0]}` : "";
  // Never read form-field values here (only tag/id/class/label) — this is a
  // click-target descriptor, not a data-capture mechanism.
  const isFormField = tag === "input" || tag === "textarea" || tag === "select";
  const label = isFormField
    ? ""
    : (clickable.getAttribute("aria-label") || clickable.textContent || "").trim().slice(0, 40);
  return `${tag}${id}${cls}${label ? `:${label}` : ""}`.slice(0, 200);
};

export default function ActivityTracker() {
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const bufferRef = useRef<ActivityEvent[]>([]);
  const scrollCheckpointsRef = useRef<Set<number>>(new Set());
  const sessionIdRef = useRef<string>("");

  const flush = () => {
    if (!bufferRef.current.length) return;
    sendActivityEvents(sessionIdRef.current, bufferRef.current);
    bufferRef.current = [];
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    sessionIdRef.current = getSessionId();

    const flushInterval = window.setInterval(flush, FLUSH_INTERVAL_MS);
    const heartbeatInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") sendHeartbeat(window.location.pathname);
    }, HEARTBEAT_INTERVAL_MS);
    sendHeartbeat(window.location.pathname);

    const onClick = (event: MouseEvent) => {
      bufferRef.current.push({
        type: "click",
        path: window.location.pathname,
        target: describeTarget(event.target),
        ts: new Date().toISOString(),
      });
    };

    const onScroll = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      const pct = scrollable > 0 ? Math.round(((window.scrollY || doc.scrollTop) / scrollable) * 100) : 100;
      for (const checkpoint of SCROLL_CHECKPOINTS) {
        if (pct >= checkpoint && !scrollCheckpointsRef.current.has(checkpoint)) {
          scrollCheckpointsRef.current.add(checkpoint);
          bufferRef.current.push({
            type: "scroll",
            path: window.location.pathname,
            scrollDepth: checkpoint,
            ts: new Date().toISOString(),
          });
        }
      }
    };

    const onVisibilityOrHide = () => {
      if (document.visibilityState === "hidden") flush();
    };

    document.addEventListener("click", onClick, { capture: true });
    document.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityOrHide);
    window.addEventListener("pagehide", flush);

    return () => {
      window.clearInterval(flushInterval);
      window.clearInterval(heartbeatInterval);
      document.removeEventListener("click", onClick, { capture: true });
      document.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibilityOrHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    scrollCheckpointsRef.current = new Set();
    bufferRef.current.push({
      type: "pageview",
      path: location.pathname,
      ts: new Date().toISOString(),
    });
    sendHeartbeat(location.pathname);
  }, [isAuthenticated, location.pathname]);

  return null;
}

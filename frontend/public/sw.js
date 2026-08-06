const TOOLHUB_CACHE_PREFIX = "toolhub-pwa-";
const TOOLHUB_CACHE_VERSION = "2026-07-29-small-lights";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(TOOLHUB_CACHE_PREFIX) && key !== `${TOOLHUB_CACHE_PREFIX}${TOOLHUB_CACHE_VERSION}`)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(new Request(event.request, { cache: "no-store" })));
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

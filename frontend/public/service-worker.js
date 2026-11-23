const CACHE_NAME = "ethiofoodcast-shell-v6";
const APP_ROUTES = new Set([
  "/",
  "/assess",
  "/areas",
  "/batch",
  "/knowledge",
  "/method",
  "/plan",
  "/segments",
  "/situation",
  "/spatial",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll([
        "/",
        "/offline.html",
        "/manifest.webmanifest",
        "/icon.svg",
        "/icon-192.png",
        "/icon-512.png",
        "/pdf.worker.mjs",
      ]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("ethiofoodcast-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request, url));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icon")
    || url.pathname === "/ethiopia-admin1.geojson" || url.pathname === "/pdf.worker.mjs") {
    event.respondWith(cacheFirstAsset(request));
    return;
  }

  if (url.searchParams.has("_rsc")) {
    event.respondWith(networkFirstRsc(request));
  }
});

async function networkFirstNavigation(request, url) {
  let response;
  try {
    response = await fetch(request);
  } catch {
    const cachedPage = await caches.match(request, { ignoreSearch: true });
    if (cachedPage) return cachedPage;
    return (await caches.match("/offline.html")) || Response.error();
  }

  const isAppPage = APP_ROUTES.has(url.pathname) || url.pathname.startsWith("/knowledge/");
  if (response.ok && isAppPage && !url.search) {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    } catch (error) {
      console.error("Could not cache this page for offline use.", error);
    }
  }
  return response;
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    try {
      await cache.put(request, response.clone());
    } catch (error) {
      console.error("Could not cache this asset for offline use.", error);
    }
  }
  return response;
}

async function networkFirstRsc(request) {
  let response;
  try {
    response = await fetch(request);
  } catch {
    const cached = await caches.match(request);
    return cached || new Response("Offline route data is not cached.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  if (response.ok) {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    } catch (error) {
      console.error("Could not cache route data for offline use.", error);
    }
  }
  return response;
}

// Service worker do Zerômetro. Por enquanto, só uma coisa: navegação sem rede mostra /offline.html.
// Não guarda o app nem a API em cache: os assets já têm hash e a SPA depende da API, então cache
// aqui só arriscaria prender um deploy antigo. Servido sem cache por src/server/static.ts.

const CACHE = "zerometro-offline-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"];

// Login com Google, OAuth do MCP e a API passam direto, sem o service worker no meio.
const BYPASS = ["/api/", "/mcp", "/.well-known/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      // Busca a página em paralelo com o boot do service worker (não atrasa a navegação).
      await self.registration.navigationPreload?.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (BYPASS.some((prefix) => url.pathname.startsWith(prefix))) return;

  event.respondWith(
    (async () => {
      try {
        return (await event.preloadResponse) ?? (await fetch(request));
      } catch {
        return (await caches.match(OFFLINE_URL)) ?? Response.error();
      }
    })(),
  );
});

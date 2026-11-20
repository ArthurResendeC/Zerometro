// Service worker do Zerômetro: guarda o app (index.html + JS/CSS/ícones/fontes) para abrir sem
// internet. Os dados vêm do cache do TanStack Query (IndexedDB) e as escritas offline vão pela
// fila do app; a API nunca passa por aqui. Servido sem cache por src/server/static.ts.

const VERSION = "v2";
const SHELL_CACHE = `zerometro-shell-${VERSION}`;
const ASSET_CACHE = `zerometro-assets-${VERSION}`;
const FONT_CACHE = `zerometro-fonts-${VERSION}`;
const KNOWN_CACHES = new Set([SHELL_CACHE, ASSET_CACHE, FONT_CACHE]);

/** Toda rota da SPA devolve o mesmo index.html: guardado numa chave só. */
const SHELL_URL = "/";
const OFFLINE_URL = "/offline.html";
const STATIC_URLS = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];

/** Internet ruim: depois disso, abre a versão guardada (a da rede atualiza o cache quando chegar). */
const NAVIGATION_TIMEOUT_MS = 4000;

// Login com Google, OAuth do MCP e a API passam direto, sem o service worker no meio.
const BYPASS = ["/api/", "/mcp", "/.well-known/", "/sw.js"];
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
/** Arquivos com hash no nome gerados pelo build (ex.: chunk-ccr6g515.js): podem ser apagados. */
const HASHED_ASSET = /-[a-z0-9]{8}\.[a-z0-9]+$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const assets = await caches.open(ASSET_CACHE);
      await assets.addAll(STATIC_URLS);
      // A primeira visita carrega antes de o service worker existir: guarda o app agora.
      await refreshShell(await fetch(SHELL_URL, { cache: "no-cache" })).catch(() => {});
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !KNOWN_CACHES.has(key)).map((key) => caches.delete(key)),
      );
      // Busca a página em paralelo com o boot do service worker (não atrasa a navegação).
      await self.registration.navigationPreload?.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (BYPASS.some((prefix) => url.pathname.startsWith(prefix))) return;
    if (request.mode === "navigate") {
      event.respondWith(navigate(event));
    } else if (/\.[a-z0-9]+$/i.test(url.pathname)) {
      event.respondWith(cacheFirst(request));
    }
  } else if (FONT_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event, request, FONT_CACHE));
  }
});

/** Rede primeiro (com timeout); sem rede, o app guardado; sem app guardado, a página offline. */
async function navigate(event) {
  const network = (async () => {
    const response = (await event.preloadResponse) ?? (await fetch(event.request));
    if (response.ok && isHtml(response)) event.waitUntil(refreshShell(response.clone()));
    return response;
  })();
  // Se a rede responder depois do timeout, o cache ainda é atualizado.
  event.waitUntil(network.catch(() => {}));

  try {
    return await Promise.race([network, timeout(NAVIGATION_TIMEOUT_MS)]);
  } catch {
    const shell = await caches.match(SHELL_URL, { cacheName: SHELL_CACHE });
    if (shell) return shell;
    return (await caches.match(OFFLINE_URL)) ?? Response.error();
  }
}

/**
 * Guarda o index.html novo e os assets que ele cita, e apaga os assets com hash que ele não
 * cita mais (de deploys anteriores), para o cache não crescer para sempre.
 */
async function refreshShell(response) {
  if (!response.ok || !isHtml(response)) return;
  const html = await response.clone().text();
  const referenced = [...html.matchAll(/(?:src|href)="(\/[^"/][^"]*)"/g)].map((m) => m[1]);

  const assets = await caches.open(ASSET_CACHE);
  const cachedPaths = new Set((await assets.keys()).map((r) => new URL(r.url).pathname));
  await assets.addAll(referenced.filter((path) => !cachedPaths.has(path)));

  const keep = new Set(referenced);
  const stale = [...cachedPaths].filter((path) => HASHED_ASSET.test(path) && !keep.has(path));
  await Promise.all(stale.map((path) => assets.delete(path)));

  const shell = await caches.open(SHELL_CACHE);
  await shell.put(SHELL_URL, response);
  await cacheFonts(html).catch(() => {});
}

/** Folha de fontes do Google citada no HTML e os arquivos de fonte que ela usa. */
async function cacheFonts(html) {
  const fonts = await caches.open(FONT_CACHE);
  const sheets = [...html.matchAll(/href="(https:\/\/fonts\.googleapis\.com\/css2[^"]*)"/g)];
  await Promise.all(
    sheets.map(async ([, href]) => {
      const url = href.replaceAll("&amp;", "&");
      if (await fonts.match(url)) return;
      const css = await fetch(url, { mode: "cors" });
      if (!css.ok) return;
      const files = [...(await css.clone().text()).matchAll(/url\((https:[^)]+)\)/g)];
      await fonts.addAll(files.map((m) => m[1]));
      await fonts.put(url, css);
    }),
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: ASSET_CACHE });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const assets = await caches.open(ASSET_CACHE);
    await assets.put(request, response.clone());
  }
  return response;
}

/** Fontes: responde do cache na hora e atualiza em segundo plano. */
async function staleWhileRevalidate(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then(async (response) => {
    if (response.ok || response.type === "opaque") await cache.put(request, response.clone());
    return response;
  });
  if (cached) {
    event.waitUntil(network.catch(() => {}));
    return cached;
  }
  return network;
}

function isHtml(response) {
  return (response.headers.get("Content-Type") ?? "").includes("text/html");
}

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

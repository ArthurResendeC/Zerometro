// Arquivos do PWA que precisam de URL fixa na raiz (fora do bundler do HTML, que põe hash no nome):
// ícones citados pelo manifest, service worker (escopo `/` exige `/sw.js`) e página offline.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Em dev é `src/web/public`; no bundle (`dist/index.js`) é `dist/public`, copiada pelo `scripts/build.ts`. */
export const PUBLIC_DIR = [
  join(import.meta.dir, "public"),
  join(import.meta.dir, "../web/public"),
].find((dir) => existsSync(dir));

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** Ícones mudam raramente; o resto (sw.js, offline.html) precisa chegar novo a cada deploy. */
function cacheControl(path: string) {
  return path.startsWith("icons/") ? "public, max-age=86400" : "no-cache";
}

/**
 * Uma rota exata por arquivo de `dir` (lido no boot): `/icons/icon-192.png`, `/sw.js` etc.
 * Só existem as URLs dos arquivos listados, então não há como pedir caminhos fora da pasta.
 */
export function createPublicRoutes(dir: string | undefined) {
  const routes: Record<string, () => Response> = {};
  if (!dir) return routes;
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name)
      .slice(dir.length + 1)
      .replaceAll("\\", "/");
    const extension = path.slice(path.lastIndexOf("."));
    const headers = {
      "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      "Cache-Control": cacheControl(path),
    };
    const file = join(dir, path);
    routes[`/${path}`] = () => new Response(Bun.file(file), { headers });
  }
  return routes;
}

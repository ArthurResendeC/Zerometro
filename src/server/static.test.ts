import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PUBLIC_DIR, createPublicRoutes } from "./static";

function publicDir() {
  const dir = mkdtempSync(join(tmpdir(), "zerometro-public-"));
  mkdirSync(join(dir, "icons"));
  writeFileSync(join(dir, "icons", "icon-192.png"), "png");
  writeFileSync(join(dir, "sw.js"), "self.addEventListener('fetch', () => {});");
  writeFileSync(join(dir, "offline.html"), "<!doctype html>");
  return dir;
}

describe("createPublicRoutes", () => {
  test("uma rota exata por arquivo, inclusive em subpastas", () => {
    const routes = createPublicRoutes(publicDir());
    expect(Object.keys(routes).toSorted()).toEqual([
      "/icons/icon-192.png",
      "/offline.html",
      "/sw.js",
    ]);
  });

  test("service worker sem cache e com o tipo de JavaScript", async () => {
    const res = createPublicRoutes(publicDir())["/sw.js"]!();
    expect(res.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(await res.text()).toContain("addEventListener");
  });

  test("ícones com cache de um dia", () => {
    const res = createPublicRoutes(publicDir())["/icons/icon-192.png"]!();
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
  });

  test("sem pasta, nenhuma rota", () => {
    expect(createPublicRoutes(undefined)).toEqual({});
  });

  test("em dev, acha src/web/public com os ícones do manifest", () => {
    const routes = createPublicRoutes(PUBLIC_DIR);
    expect(Object.keys(routes)).toEqual(
      expect.arrayContaining([
        "/icons/icon-192.png",
        "/icons/icon-512.png",
        "/icons/icon-maskable-512.png",
      ]),
    );
  });
});

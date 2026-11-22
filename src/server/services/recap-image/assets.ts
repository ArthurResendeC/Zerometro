import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { initWasm } from "@resvg/resvg-wasm";
import type { Font } from "satori";

// Fontes e o wasm do resvg para desenhar a imagem do recap. Em dev vêm de node_modules; a imagem
// de produção não tem node_modules, então o `scripts/build.ts` copia estes arquivos para
// `dist/recap-assets/` (o bundle roda de dentro de dist/, como as migrations).

export const RECAP_ASSET_SPECS = {
  pixel: "@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff",
  pixelExt: "@fontsource/press-start-2p/files/press-start-2p-latin-ext-400-normal.woff",
  text: "@fontsource/vt323/files/vt323-latin-400-normal.woff",
  textExt: "@fontsource/vt323/files/vt323-latin-ext-400-normal.woff",
  resvg: "@resvg/resvg-wasm/index_bg.wasm",
} as const;

export const RECAP_ASSETS_DIR = "recap-assets";

export function recapAssetPath(spec: string): string {
  const bundled = join(import.meta.dir, RECAP_ASSETS_DIR, basename(spec));
  return existsSync(bundled) ? bundled : Bun.resolveSync(spec, import.meta.dir);
}

export const PIXEL_FONT = "Press Start 2P";
export const TEXT_FONT = "VT323";

let loading: Promise<Font[]> | null = null;

const read = (spec: string) => Bun.file(recapAssetPath(spec)).arrayBuffer();
const font = (name: string, data: ArrayBuffer): Font => ({
  name,
  data,
  weight: 400,
  style: "normal",
});

/** Carrega as fontes e inicia o resvg uma vez por processo (o `initWasm` só aceita uma chamada). */
export function loadRecapAssets(): Promise<Font[]> {
  loading ??= (async () => {
    const s = RECAP_ASSET_SPECS;
    const [pixel, pixelExt, text, textExt, wasm] = await Promise.all(
      [s.pixel, s.pixelExt, s.text, s.textExt, s.resvg].map(read),
    );
    await initWasm(wasm!);
    return [
      font(PIXEL_FONT, pixel!),
      font(PIXEL_FONT, pixelExt!),
      font(TEXT_FONT, text!),
      font(TEXT_FONT, textExt!),
    ];
  })().catch((error: unknown) => {
    // Falhou (arquivo faltando no deploy?): a próxima tentativa recomeça.
    loading = null;
    throw error;
  });
  return loading;
}

// Build de produção: servidor + SPA (via HTML import) num único bundle em ./dist.
import { cpSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import tailwind from "bun-plugin-tailwind";
import { RECAP_ASSETS_DIR, RECAP_ASSET_SPECS } from "../src/server/services/recap-image/assets";

rmSync("./dist", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["./src/server/index.ts"],
  outdir: "./dist",
  root: "./src",
  // Tudo na raiz de dist/; em produção o servidor roda com cwd = dist/ (ver tarefa `start`).
  naming: { entry: "[name].[ext]" },
  target: "bun",
  publicPath: "/", // assets absolutos: deep links da SPA (/jogos/123) continuam funcionando
  minify: true,
  sourcemap: "linked",
  plugins: [tailwind],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// O servidor aplica as migrations no boot a partir de dist/migrations (import.meta.dir do bundle).
cpSync("./src/server/db/migrations", "./dist/migrations", { recursive: true });
// Arquivos do PWA com URL fixa (ícones do manifest, service worker, página offline): ver src/server/static.ts.
cpSync("./src/web/public", "./dist/public", { recursive: true });

// Fontes e wasm da imagem do recap: a imagem de produção não tem node_modules.
for (const spec of Object.values(RECAP_ASSET_SPECS)) {
  cpSync(Bun.resolveSync(spec, import.meta.dir), join("./dist", RECAP_ASSETS_DIR, basename(spec)));
}

for (const output of result.outputs) console.log(output.path);
console.log("dist/migrations");
console.log("dist/public");
console.log(`dist/${RECAP_ASSETS_DIR}`);

// Build de produção: servidor + SPA (via HTML import) num único bundle em ./dist.
import tailwind from "bun-plugin-tailwind";

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

for (const output of result.outputs) console.log(output.path);

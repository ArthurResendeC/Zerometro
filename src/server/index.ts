import { env } from "./env";
import { createApp } from "./app";
import { createAuth, resolvePublicUrl, tokenProblem } from "./auth";
import { db } from "./db";
import { runMigrations } from "./db/client";
import { createRootRoutes } from "./mcp/routes";
import { createAchievementCatalog } from "./services/achievement-catalog";
import { createFeedsService } from "./services/feeds";
import { createGamePagesService } from "./services/game-pages";
import { createIgdbFromEnv } from "./services/igdb";
import { createRetroAchievementsFromEnv } from "./services/retroachievements";
import { createSteamFromEnv } from "./services/steam";
import { createSteamUserFromEnv } from "./services/steam/user";
import { PUBLIC_DIR, createPublicRoutes } from "./static";
import index from "../web/index.html";

const isProduction = env.NODE_ENV === "production";

// Configuração antes de tudo: um deploy que não sobe não pode ter migrado o banco.
const problem = tokenProblem(env.ZEROMETRO_TOKEN);
if (problem) {
  console.error(problem);
  process.exit(1);
}
let publicUrl: string;
try {
  publicUrl = resolvePublicUrl(env);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

// Migrations no boot: na Railway o volume do SQLite só é montado quando o container sobe
// (não no build nem no pre-deploy). Uma réplica só, então não há corrida.
runMigrations(db);

const auth = createAuth({ token: env.ZEROMETRO_TOKEN!, publicUrl });

const igdb = createIgdbFromEnv(db, env);
const clock = { now: () => new Date(), timeZone: env.TZ };
const deps = {
  db,
  auth,
  igdb,
  feeds: createFeedsService({ db, igdb, clock }),
  gamePages: createGamePagesService({ db, igdb, clock }),
  achievements: createAchievementCatalog({
    db,
    clock,
    steam: createSteamFromEnv(env),
    retroachievements: createRetroAchievementsFromEnv(env),
  }),
  steamUser: createSteamUserFromEnv(env),
  clock,
};
const app = createApp(deps);
const root = createRootRoutes(deps);

// Um único processo: API (Hono) em /api/*, MCP em /mcp, OAuth do MCP na raiz (/.well-known/*,
// /register, /authorize, /token), arquivos do PWA com URL fixa (ícones, /sw.js, /offline.html)
// e a SPA (HTML import do Bun) no resto.
const server = Bun.serve({
  port: env.PORT,
  routes: {
    "/api/*": (req) => app.fetch(req),
    "/mcp": root.mcp,
    ...root.oauth,
    "/.well-known/*": () => new Response("Not found", { status: 404 }),
    ...createPublicRoutes(PUBLIC_DIR),
    "/*": index,
  },
  development: !isProduction && { hmr: true, console: true },
});

console.log(`Zerômetro rodando em ${server.url} (público: ${publicUrl})`);

// Deploy/restart: para de aceitar conexões e fecha o SQLite (checkpoint do WAL).
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    await server.stop();
    db.$client.close();
    process.exit(0);
  });
}

import { env } from "./env";
import { createApp } from "./app";
import { createAuth, createAuthGateway, parseEmailList, resolvePublicUrl } from "./auth";
import { db } from "./db";
import { runMigrations } from "./db/client";
import { createRootRoutes } from "./mcp/routes";
import { createFeedsService } from "./services/feeds";
import { createGamePagesService } from "./services/game-pages";
import { createIgdbFromEnv } from "./services/igdb";
import index from "../web/index.html";

const isProduction = env.NODE_ENV === "production";

// Migrations no boot: na Railway o volume do SQLite só é montado quando o container sobe
// (não no build nem no pre-deploy). Uma réplica só, então não há corrida.
runMigrations(db);

if (!env.BETTER_AUTH_SECRET && isProduction) {
  console.error("BETTER_AUTH_SECRET é obrigatório em produção (openssl rand -base64 32)");
  process.exit(1);
}
let publicUrl: string;
try {
  publicUrl = resolvePublicUrl(env);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
const allowedEmails = parseEmailList(env.ALLOWED_EMAILS);
const google =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
    : undefined;
if (!google)
  console.warn("⚠️  GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET ausentes: ninguém consegue entrar");
if (allowedEmails.length === 0) console.warn("⚠️  ALLOWED_EMAILS vazio: ninguém consegue entrar");

const auth = createAuth({
  db,
  // Em dev sem segredo, as sessões só valem até reiniciar o servidor.
  secret: env.BETTER_AUTH_SECRET ?? crypto.randomUUID() + crypto.randomUUID(),
  baseURL: publicUrl,
  google,
  allowedEmails,
});

const igdb = createIgdbFromEnv(db, env);
const clock = { now: () => new Date(), timeZone: env.TZ };
const deps = {
  db,
  auth: createAuthGateway(auth, allowedEmails),
  igdb,
  feeds: createFeedsService({ db, igdb, clock }),
  gamePages: createGamePagesService({ db, igdb, clock }),
  clock,
};
const app = createApp(deps);
const root = createRootRoutes(deps);

// Um único processo: API (Hono) em /api/*, MCP em /mcp, descoberta OAuth em /.well-known/*
// e a SPA (HTML import do Bun) no resto.
const server = Bun.serve({
  port: env.PORT,
  routes: {
    "/api/*": (req) => app.fetch(req),
    "/mcp": root.mcp,
    "/.well-known/*": root.wellKnown,
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

import { env } from "./env";
import { createApp } from "./app";
import { createAuth, createAuthGateway, parseEmailList } from "./auth";
import { db } from "./db";
import { createIgdbFromEnv } from "./services/igdb";
import index from "../web/index.html";

const isProduction = env.NODE_ENV === "production";

if (!env.BETTER_AUTH_SECRET && isProduction) {
  console.error("BETTER_AUTH_SECRET é obrigatório em produção (openssl rand -base64 32)");
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
  baseURL: env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT}`,
  google,
  allowedEmails,
});

const app = createApp({
  db,
  auth: createAuthGateway(auth, allowedEmails),
  igdb: createIgdbFromEnv(db, env),
  clock: { now: () => new Date(), timeZone: env.TZ },
});

// Um único processo: API (Hono) em /api/*, SPA (HTML import do Bun) no resto.
const server = Bun.serve({
  port: env.PORT,
  routes: {
    "/api/*": (req) => app.fetch(req),
    "/*": index,
  },
  development: !isProduction && { hmr: true, console: true },
});

console.log(`Zerômetro rodando em ${server.url}`);

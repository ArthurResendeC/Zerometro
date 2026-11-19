import { env } from "./env";
import { createApp } from "./app";
import { db } from "./db";
import { createIgdbFromEnv } from "./services/igdb";
import { todayIn } from "../shared/dates";
import index from "../web/index.html";

const app = createApp({
  db,
  igdb: createIgdbFromEnv(db, env),
  today: () => todayIn(env.TZ),
});

// Um único processo: API (Hono) em /api/*, SPA (HTML import do Bun) no resto.
const server = Bun.serve({
  port: env.PORT,
  routes: {
    "/api/*": (req) => app.fetch(req),
    "/*": index,
  },
  development: env.NODE_ENV !== "production" && { hmr: true, console: true },
});

console.log(`Zerômetro rodando em ${server.url}`);

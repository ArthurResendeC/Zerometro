import { env } from "./env";
import { app } from "./app";
import index from "../web/index.html";

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

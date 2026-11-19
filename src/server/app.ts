import { Hono } from "hono";
import { logger } from "hono/logger";
import { healthRoutes } from "./routes/health";

// Rotas encadeadas para o cliente RPC (`hc<AppType>`) inferir os tipos.
export const app = new Hono().basePath("/api").use(logger()).route("/health", healthRoutes);

export type AppType = typeof app;

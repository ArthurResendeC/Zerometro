import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import type { Db } from "./db/client";
import { AppError, type ApiErrorBody } from "./errors";
import { healthRoutes } from "./routes/health";
import { createIgdbRoutes } from "./routes/igdb";
import { createLibraryRoutes } from "./routes/library";
import { createSessionRoutes } from "./routes/sessions";
import { createSettingsRoutes } from "./routes/settings";
import { createStatsRoutes } from "./routes/stats";
import type { IgdbApi } from "./services/igdb";

export interface AppDeps {
  db: Db;
  igdb: IgdbApi;
  /** "Hoje" (YYYY-MM-DD) no fuso do usuário; injetável para testes. */
  today: () => string;
  /** Log de requisições (desligado nos testes). */
  logRequests?: boolean;
}

export function createApp(deps: AppDeps) {
  const app = new Hono().basePath("/api");
  if (deps.logRequests ?? true) app.use(logger());

  // Rotas encadeadas para o cliente RPC (`hc<AppType>`) inferir os tipos.
  return app
    .onError((error, c) => {
      if (error instanceof HTTPException) return error.getResponse();
      if (error instanceof AppError) {
        if (error.status >= 500) console.error(error);
        return c.json<ApiErrorBody>(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      console.error(error);
      return c.json<ApiErrorBody>(
        { error: { code: "internal_error", message: "Erro interno" } },
        500,
      );
    })
    .route("/health", healthRoutes)
    .route("/igdb", createIgdbRoutes(deps))
    .route("/library", createLibraryRoutes(deps))
    .route("/sessions", createSessionRoutes(deps))
    .route("/stats", createStatsRoutes(deps))
    .route("/settings", createSettingsRoutes(deps));
}

export type AppType = ReturnType<typeof createApp>;

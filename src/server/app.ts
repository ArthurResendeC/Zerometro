import { Hono } from "hono";
import type { AuthGateway } from "./auth";
import type { AppEnv } from "./lib/hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import type { Db } from "./db/client";
import { AppError, type ApiErrorBody } from "./errors";
import { createCompletionRoutes } from "./routes/completions";
import { createFeedRoutes } from "./routes/feeds";
import { healthRoutes } from "./routes/health";
import { createIgdbRoutes } from "./routes/igdb";
import { createLibraryRoutes } from "./routes/library";
import { createSessionRoutes } from "./routes/sessions";
import { createSettingsRoutes } from "./routes/settings";
import { createStatsRoutes } from "./routes/stats";
import { createTimerRoutes } from "./routes/timer";
import type { Clock } from "./services/context";
import type { FeedsService } from "./services/feeds";
import type { GamePagesService } from "./services/game-pages";
import type { IgdbApi } from "./services/igdb";

export interface AppDeps {
  db: Db;
  /** Login (Better Auth) e resolução do usuário da requisição; injetável para testes. */
  auth: AuthGateway;
  igdb: IgdbApi;
  /** Listas do IGDB da tela inicial (cache compartilhado entre requisições). */
  feeds: FeedsService;
  /** Dados do IGDB da página de cada jogo (cache compartilhado entre requisições). */
  gamePages: GamePagesService;
  /** Relógio e fuso do usuário; injetável para testes. */
  clock: Clock;
  /** Log de requisições (desligado nos testes). */
  logRequests?: boolean;
}

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>().basePath("/api");
  if (deps.logRequests ?? true) app.use(logger());

  // Rotas encadeadas para o cliente RPC (`hc<AppType>`) inferir os tipos.
  return (
    app
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
      // Login, callback do Google, logout etc. (públicas).
      .on(["GET", "POST"], "/auth/*", (c) => deps.auth.handler(c.req.raw))
      // Daqui para baixo, só com sessão válida de um convidado.
      .use(async (c, next) => {
        const userId = await deps.auth.getUserId(c.req.raw.headers);
        if (!userId) {
          return c.json<ApiErrorBody>(
            { error: { code: "unauthorized", message: "Entre para continuar" } },
            401,
          );
        }
        c.set("userId", userId);
        await next();
      })
      .route("/igdb", createIgdbRoutes(deps))
      .route("/feeds", createFeedRoutes(deps))
      .route("/library", createLibraryRoutes(deps))
      .route("/sessions", createSessionRoutes(deps))
      .route("/completions", createCompletionRoutes(deps))
      .route("/stats", createStatsRoutes(deps))
      .route("/settings", createSettingsRoutes(deps))
      .route("/timer", createTimerRoutes(deps))
  );
}

export type AppType = ReturnType<typeof createApp>;

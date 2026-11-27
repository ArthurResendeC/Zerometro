import { Hono } from "hono";
import type { RecapImageRenderer } from "./services/recap-image";
import type { Auth } from "./auth";
import type { AppEnv } from "./lib/hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import type { Db } from "./db/client";
import type { AuthSession } from "../shared/auth";
import { AppError, type ApiErrorBody } from "./errors";
import { createAuthRoutes, requireAuth } from "./routes/auth";
import { createCompletionRoutes } from "./routes/completions";
import { createFeedRoutes } from "./routes/feeds";
import { healthRoutes } from "./routes/health";
import { createIgdbRoutes } from "./routes/igdb";
import { createLibraryRoutes } from "./routes/library";
import { createObjectiveRoutes } from "./routes/objectives";
import { createRatingRoutes } from "./routes/ratings";
import { createSessionRoutes } from "./routes/sessions";
import { createSettingsRoutes } from "./routes/settings";
import { createStatsRoutes } from "./routes/stats";
import { createProfileRoutes } from "./routes/profile";
import { createSteamRoutes } from "./routes/steam";
import { createTimerRoutes } from "./routes/timer";
import type { AchievementCatalog } from "./services/achievement-catalog";
import type { Clock } from "./services/context";
import type { FeedsService } from "./services/feeds";
import type { GamePagesService } from "./services/game-pages";
import type { IgdbApi } from "./services/igdb";
import type { SteamUserApi } from "./services/steam/user";

export interface AppDeps {
  db: Db;
  /** Token da instância: login do site, sessão por cookie e OAuth do MCP. */
  auth: Auth;
  igdb: IgdbApi;
  /** Listas do IGDB da tela inicial (cache compartilhado entre requisições). */
  feeds: FeedsService;
  /** Dados do IGDB da página de cada jogo (cache compartilhado entre requisições). */
  gamePages: GamePagesService;
  /** Listas de conquistas da Steam e do RetroAchievements (cache compartilhado). */
  achievements: AchievementCatalog;
  /** Conta Steam de quem usa o app (perfil, desbloqueios e horas) para sincronizar. */
  steamUser: SteamUserApi;
  /** Imagem do recap para compartilhar (busca as capas no IGDB). */
  recapImages: RecapImageRenderer;
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
      // Entrar e sair (públicas).
      .route("/auth", createAuthRoutes(deps))
      // Daqui para baixo, só com o cookie de sessão ou o token.
      .use(requireAuth(deps.auth))
      .get("/auth/session", (c) => c.json<AuthSession>({ userId: c.get("userId") }))
      .route("/igdb", createIgdbRoutes(deps))
      .route("/feeds", createFeedRoutes(deps))
      .route("/library", createLibraryRoutes(deps))
      .route("/sessions", createSessionRoutes(deps))
      .route("/completions", createCompletionRoutes(deps))
      .route("/objectives", createObjectiveRoutes(deps))
      .route("/ratings", createRatingRoutes(deps))
      .route("/stats", createStatsRoutes(deps))
      .route("/profile", createProfileRoutes(deps))
      .route("/settings", createSettingsRoutes(deps))
      .route("/steam", createSteamRoutes(deps))
      .route("/timer", createTimerRoutes(deps))
  );
}

export type AppType = ReturnType<typeof createApp>;

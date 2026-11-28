import { z } from "zod";
import { leaderboardQuerySchema } from "../../shared/group";
import { statsPeriodSchema } from "../../shared/stats";
import type { AppDeps } from "../app";
import { createRouter, webContext } from "../lib/hono";
import { validate } from "../lib/validate";
import {
  getGameInGroup,
  getLeaderboard,
  getMemberGamerProfile,
  getMemberProfile,
  getMemberStats,
} from "../services/group";

const handleOf = (raw: string) => raw.toLowerCase();

// O grupo: ranking, perfil público de cada um (resumo, estatísticas e perfil de gamer, só o
// que a pessoa compartilha) e quem tem um jogo.
export function createGroupRoutes(deps: Pick<AppDeps, "db" | "clock">) {
  return createRouter()
    .get("/leaderboard", validate("query", leaderboardQuerySchema), (c) =>
      c.json(getLeaderboard(webContext(deps, c), c.req.valid("query").period)),
    )
    .get("/members/:handle", (c) =>
      c.json(getMemberProfile(webContext(deps, c), handleOf(c.req.param("handle")))),
    )
    .get("/members/:handle/stats", validate("query", statsPeriodSchema), (c) =>
      c.json(
        getMemberStats(webContext(deps, c), handleOf(c.req.param("handle")), c.req.valid("query")),
      ),
    )
    .get("/members/:handle/profile", (c) =>
      c.json(getMemberGamerProfile(webContext(deps, c), handleOf(c.req.param("handle")))),
    )
    .get(
      "/games/:igdbId",
      validate("param", z.object({ igdbId: z.coerce.number().int().positive() })),
      (c) => c.json(getGameInGroup(webContext(deps, c), c.req.valid("param").igdbId)),
    );
}

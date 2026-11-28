import { z } from "zod";
import { leaderboardQuerySchema } from "../../shared/group";
import type { AppDeps } from "../app";
import { createRouter, webContext } from "../lib/hono";
import { validate } from "../lib/validate";
import { getGameInGroup, getLeaderboard, getMemberProfile } from "../services/group";

// O grupo: ranking, perfil público de cada um e quem tem um jogo.
export function createGroupRoutes(deps: Pick<AppDeps, "db" | "clock">) {
  return createRouter()
    .get("/leaderboard", validate("query", leaderboardQuerySchema), (c) =>
      c.json(getLeaderboard(webContext(deps, c), c.req.valid("query").period)),
    )
    .get("/members/:handle", (c) =>
      c.json(getMemberProfile(webContext(deps, c), c.req.param("handle").toLowerCase())),
    )
    .get(
      "/games/:igdbId",
      validate("param", z.object({ igdbId: z.coerce.number().int().positive() })),
      (c) => c.json(getGameInGroup(webContext(deps, c), c.req.valid("param").igdbId)),
    );
}

import { z } from "zod";
import { igdbIdSchema, igdbSearchQuerySchema } from "../../shared/igdb";
import type { AppDeps } from "../app";
import { createRouter } from "../lib/hono";
import { validate } from "../lib/validate";

export function createIgdbRoutes({ igdb, gamePages }: Pick<AppDeps, "igdb" | "gamePages">) {
  return createRouter()
    .get("/search", validate("query", igdbSearchQuerySchema), async (c) => {
      const { q, limit } = c.req.valid("query");
      return c.json({ results: await igdb.searchGames(q, limit) });
    })
    .get("/games/:igdbId", validate("param", z.object({ igdbId: igdbIdSchema })), async (c) => {
      const { value, updatedAt } = await gamePages.get(c.req.valid("param").igdbId);
      return c.json({ game: value, updatedAt });
    });
}

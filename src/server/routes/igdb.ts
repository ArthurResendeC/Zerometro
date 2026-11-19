import { igdbSearchQuerySchema } from "../../shared/igdb";
import type { AppDeps } from "../app";
import { createRouter } from "../lib/hono";
import { validate } from "../lib/validate";

export function createIgdbRoutes({ igdb }: Pick<AppDeps, "igdb">) {
  return createRouter().get("/search", validate("query", igdbSearchQuerySchema), async (c) => {
    const { q, limit } = c.req.valid("query");
    return c.json({ results: await igdb.searchGames(q, limit) });
  });
}

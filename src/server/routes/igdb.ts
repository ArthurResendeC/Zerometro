import { Hono } from "hono";
import { igdbSearchQuerySchema } from "../../shared/igdb";
import type { AppDeps } from "../app";
import { validate } from "../lib/validate";

export function createIgdbRoutes({ igdb }: Pick<AppDeps, "igdb">) {
  return new Hono().get("/search", validate("query", igdbSearchQuerySchema), async (c) => {
    const { q, limit } = c.req.valid("query");
    return c.json({ results: await igdb.searchGames(q, limit) });
  });
}

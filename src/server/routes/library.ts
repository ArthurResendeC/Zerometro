import { Hono } from "hono";
import {
  addToLibrarySchema,
  gameIdParamSchema,
  libraryListQuerySchema,
  updateLibraryEntrySchema,
} from "../../shared/library";
import type { AppDeps } from "../app";
import { validate } from "../lib/validate";
import { createContext, type ServiceContext } from "../services/context";
import {
  addToLibrary,
  countByStatus,
  getLibraryItem,
  listLibrary,
  removeFromLibrary,
  updateLibraryEntry,
} from "../services/library";

export function createLibraryRoutes(deps: AppDeps) {
  const ctx = (): ServiceContext => createContext(deps.db, deps.clock, "web");

  return new Hono()
    .get("/", validate("query", libraryListQuerySchema), (c) => {
      const query = c.req.valid("query");
      return c.json({ items: listLibrary(deps.db, query), counts: countByStatus(deps.db) });
    })
    .post("/", validate("json", addToLibrarySchema), async (c) => {
      const item = await addToLibrary(ctx(), deps.igdb, c.req.valid("json"));
      return c.json({ item }, 201);
    })
    .get("/:gameId", validate("param", gameIdParamSchema), (c) => {
      return c.json({ item: getLibraryItem(deps.db, c.req.valid("param").gameId) });
    })
    .patch(
      "/:gameId",
      validate("param", gameIdParamSchema),
      validate("json", updateLibraryEntrySchema),
      (c) => {
        const item = updateLibraryEntry(ctx(), c.req.valid("param").gameId, c.req.valid("json"));
        return c.json({ item });
      },
    )
    .delete("/:gameId", validate("param", gameIdParamSchema), (c) => {
      return c.json({ removed: removeFromLibrary(ctx(), c.req.valid("param").gameId) });
    });
}

import {
  addToLibrarySchema,
  gameIdParamSchema,
  libraryListQuerySchema,
  updateLibraryEntrySchema,
} from "../../shared/library";
import type { AppDeps } from "../app";
import { createRouter, webContext } from "../lib/hono";
import { validate } from "../lib/validate";
import {
  addToLibrary,
  countByStatus,
  getLibraryItem,
  listLibrary,
  removeFromLibrary,
  updateLibraryEntry,
} from "../services/library";

export function createLibraryRoutes(deps: AppDeps) {
  return createRouter()
    .get("/", validate("query", libraryListQuerySchema), (c) => {
      const query = c.req.valid("query");
      return c.json({
        items: listLibrary(webContext(deps, c), query),
        counts: countByStatus(webContext(deps, c)),
      });
    })
    .post("/", validate("json", addToLibrarySchema), async (c) => {
      const item = await addToLibrary(webContext(deps, c), deps.igdb, c.req.valid("json"));
      return c.json({ item }, 201);
    })
    .get("/:gameId", validate("param", gameIdParamSchema), (c) => {
      return c.json({ item: getLibraryItem(webContext(deps, c), c.req.valid("param").gameId) });
    })
    .patch(
      "/:gameId",
      validate("param", gameIdParamSchema),
      validate("json", updateLibraryEntrySchema),
      (c) => {
        const item = updateLibraryEntry(
          webContext(deps, c),
          c.req.valid("param").gameId,
          c.req.valid("json"),
        );
        return c.json({ item });
      },
    )
    .delete("/:gameId", validate("param", gameIdParamSchema), (c) => {
      return c.json({
        removed: removeFromLibrary(webContext(deps, c), c.req.valid("param").gameId),
      });
    });
}

import { z } from "zod";
import { igdbIdSchema } from "../../shared/igdb";
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
  findLibraryItemByIgdbId,
  getLibraryItem,
  listLibrary,
  removeFromLibrary,
  updateLibraryEntry,
} from "../services/library";

export function createLibraryRoutes(deps: AppDeps) {
  return (
    createRouter()
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
      // "Não está na biblioteca" é um estado normal da página do jogo: item null, sem 404.
      .get("/igdb/:igdbId", validate("param", z.object({ igdbId: igdbIdSchema })), (c) => {
        const { igdbId } = c.req.valid("param");
        return c.json({ item: findLibraryItemByIgdbId(webContext(deps, c), igdbId) });
      })
      .get("/:gameId", validate("param", gameIdParamSchema), (c) => {
        return c.json({ item: getLibraryItem(webContext(deps, c), c.req.valid("param").gameId) });
      })
      .patch(
        "/:gameId",
        validate("param", gameIdParamSchema),
        validate("json", updateLibraryEntrySchema),
        (c) => {
          const result = updateLibraryEntry(
            webContext(deps, c),
            c.req.valid("param").gameId,
            c.req.valid("json"),
          );
          return c.json(result);
        },
      )
      .delete("/:gameId", validate("param", gameIdParamSchema), (c) => {
        return c.json({
          removed: removeFromLibrary(webContext(deps, c), c.req.valid("param").gameId),
        });
      })
  );
}

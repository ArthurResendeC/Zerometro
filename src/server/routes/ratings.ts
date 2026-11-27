import {
  ratingIdParamSchema,
  ratingTemplateQuerySchema,
  updateRatingSchema,
} from "../../shared/ratings";
import type { AppDeps } from "../app";
import { createRouter, webContext } from "../lib/hono";
import { validate } from "../lib/validate";
import { deleteRating, getRatingTemplate, updateRating } from "../services/ratings";

// Avaliações soltas e o template do formulário (criar e listar ficam em /library/:gameId/ratings).
export function createRatingRoutes(deps: AppDeps) {
  return createRouter()
    .get("/template", validate("query", ratingTemplateQuerySchema), (c) => {
      const { gameId } = c.req.valid("query");
      return c.json({ template: getRatingTemplate(webContext(deps, c), gameId) });
    })
    .patch(
      "/:id",
      validate("param", ratingIdParamSchema),
      validate("json", updateRatingSchema),
      (c) => {
        const { id } = c.req.valid("param");
        return c.json(updateRating(webContext(deps, c), id, c.req.valid("json")));
      },
    )
    .delete("/:id", validate("param", ratingIdParamSchema), (c) => {
      return c.json(deleteRating(webContext(deps, c), c.req.valid("param").id));
    });
}

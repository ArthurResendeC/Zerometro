import {
  incrementObjectiveSchema,
  objectiveIdParamSchema,
  updateObjectiveSchema,
} from "../../shared/objectives";
import type { AppDeps } from "../app";
import { createRouter, webContext } from "../lib/hono";
import { validate } from "../lib/validate";
import { deleteObjective, incrementObjective, updateObjective } from "../services/objectives";

// Objetivos soltos (criar, listar e reordenar ficam em /library/:gameId/objectives).
export function createObjectiveRoutes(deps: AppDeps) {
  return createRouter()
    .patch(
      "/:id",
      validate("param", objectiveIdParamSchema),
      validate("json", updateObjectiveSchema),
      (c) => {
        const { id } = c.req.valid("param");
        return c.json(updateObjective(webContext(deps, c), id, c.req.valid("json")));
      },
    )
    .post(
      "/:id/increment",
      validate("param", objectiveIdParamSchema),
      validate("json", incrementObjectiveSchema),
      (c) => {
        const { id } = c.req.valid("param");
        return c.json(incrementObjective(webContext(deps, c), id, c.req.valid("json").by));
      },
    )
    .delete("/:id", validate("param", objectiveIdParamSchema), (c) => {
      return c.json(deleteObjective(webContext(deps, c), c.req.valid("param").id));
    });
}

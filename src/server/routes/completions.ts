import { completionIdParamSchema } from "../../shared/completions";
import type { AppDeps } from "../app";
import { createRouter, webContext } from "../lib/hono";
import { validate } from "../lib/validate";
import { removeCompletion } from "../services/completions";

// Conclusões soltas (criar e listar ficam em /library/:gameId/completions).
export function createCompletionRoutes(deps: AppDeps) {
  return createRouter().delete("/:id", validate("param", completionIdParamSchema), (c) => {
    return c.json(removeCompletion(webContext(deps, c), c.req.valid("param").id));
  });
}

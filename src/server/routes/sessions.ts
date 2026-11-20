import {
  listSessionsQuerySchema,
  logSessionSchema,
  sessionIdParamSchema,
  updateSessionSchema,
} from "../../shared/sessions";
import type { AppDeps } from "../app";
import { createRouter, webContext } from "../lib/hono";
import { validate } from "../lib/validate";
import { deleteSession, listSessions, logSession, updateSession } from "../services/sessions";

export function createSessionRoutes(deps: AppDeps) {
  return createRouter()
    .get("/", validate("query", listSessionsQuerySchema), (c) => {
      return c.json({ sessions: listSessions(webContext(deps, c), c.req.valid("query")) });
    })
    .post("/", validate("json", logSessionSchema), (c) => {
      const result = logSession(webContext(deps, c), c.req.valid("json"));
      // Reenvio da fila offline: nada foi criado agora.
      return c.json(result, result.alreadySaved ? 200 : 201);
    })
    .patch(
      "/:id",
      validate("param", sessionIdParamSchema),
      validate("json", updateSessionSchema),
      (c) => {
        const session = updateSession(
          webContext(deps, c),
          c.req.valid("param").id,
          c.req.valid("json"),
        );
        return c.json({ session });
      },
    )
    .delete("/:id", validate("param", sessionIdParamSchema), (c) => {
      return c.json({ deleted: deleteSession(webContext(deps, c), c.req.valid("param").id) });
    });
}

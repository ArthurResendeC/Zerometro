import { Hono } from "hono";
import {
  listSessionsQuerySchema,
  logSessionSchema,
  sessionIdParamSchema,
  updateSessionSchema,
} from "../../shared/sessions";
import type { AppDeps } from "../app";
import { validate } from "../lib/validate";
import { createContext, type ServiceContext } from "../services/context";
import { deleteSession, listSessions, logSession, updateSession } from "../services/sessions";

export function createSessionRoutes(deps: AppDeps) {
  const ctx = (): ServiceContext => createContext(deps.db, deps.clock, "web");

  return new Hono()
    .get("/", validate("query", listSessionsQuerySchema), (c) => {
      return c.json({ sessions: listSessions(deps.db, c.req.valid("query")) });
    })
    .post("/", validate("json", logSessionSchema), (c) => {
      return c.json(logSession(ctx(), c.req.valid("json")), 201);
    })
    .patch(
      "/:id",
      validate("param", sessionIdParamSchema),
      validate("json", updateSessionSchema),
      (c) => {
        const session = updateSession(ctx(), c.req.valid("param").id, c.req.valid("json"));
        return c.json({ session });
      },
    )
    .delete("/:id", validate("param", sessionIdParamSchema), (c) => {
      return c.json({ deleted: deleteSession(ctx(), c.req.valid("param").id) });
    });
}

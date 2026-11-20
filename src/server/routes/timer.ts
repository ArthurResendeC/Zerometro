import { cancelTimerQuerySchema, startTimerSchema, stopTimerSchema } from "../../shared/timer";
import type { AppDeps } from "../app";
import { createRouter, webContext } from "../lib/hono";
import { validate } from "../lib/validate";
import { cancelTimer, getTimerState, startTimer, stopTimer } from "../services/timer";

export function createTimerRoutes(deps: AppDeps) {
  return createRouter()
    .get("/", (c) => c.json(getTimerState(webContext(deps, c))))
    .post("/start", validate("json", startTimerSchema), (c) => {
      const result = startTimer(webContext(deps, c), c.req.valid("json"));
      return c.json(result, result.alreadyRunning ? 200 : 201);
    })
    .post("/stop", validate("json", stopTimerSchema), (c) => {
      return c.json(stopTimer(webContext(deps, c), c.req.valid("json")));
    })
    .delete("/", validate("query", cancelTimerQuerySchema), (c) => {
      const { id, clientId } = c.req.valid("query");
      const target = id ? { id } : clientId ? { clientId } : undefined;
      return c.json({ cancelled: cancelTimer(webContext(deps, c), target) });
    });
}

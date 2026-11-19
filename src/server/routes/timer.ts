import { Hono } from "hono";
import { startTimerSchema, stopTimerSchema } from "../../shared/timer";
import type { AppDeps } from "../app";
import { validate } from "../lib/validate";
import { createContext, type ServiceContext } from "../services/context";
import { cancelTimer, getTimerState, startTimer, stopTimer } from "../services/timer";

export function createTimerRoutes(deps: AppDeps) {
  const ctx = (): ServiceContext => createContext(deps.db, deps.clock, "web");

  return new Hono()
    .get("/", (c) => c.json(getTimerState(ctx())))
    .post("/start", validate("json", startTimerSchema), (c) => {
      const result = startTimer(ctx(), c.req.valid("json"));
      return c.json(result, result.alreadyRunning ? 200 : 201);
    })
    .post("/stop", validate("json", stopTimerSchema), (c) => {
      return c.json(stopTimer(ctx(), c.req.valid("json")));
    })
    .delete("/", (c) => c.json({ cancelled: cancelTimer(ctx()) }));
}

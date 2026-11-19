import { Hono } from "hono";
import type { AppDeps } from "../app";
import { createContext } from "../services/context";
import { getSettings } from "../services/settings";
import { getStats } from "../services/stats";

export function createStatsRoutes(deps: AppDeps) {
  return new Hono().get("/", (c) => {
    const { streakMinMinutes } = getSettings(deps.db);
    const { today } = createContext(deps.db, deps.clock, "web");
    return c.json(getStats(deps.db, { today, streakMinMinutes }));
  });
}

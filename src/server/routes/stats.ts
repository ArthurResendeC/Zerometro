import { Hono } from "hono";
import type { AppDeps } from "../app";
import { getSettings } from "../services/settings";
import { getStats } from "../services/stats";

export function createStatsRoutes(deps: AppDeps) {
  return new Hono().get("/", (c) => {
    const { streakMinMinutes } = getSettings(deps.db);
    return c.json(getStats(deps.db, { today: deps.today(), streakMinMinutes }));
  });
}

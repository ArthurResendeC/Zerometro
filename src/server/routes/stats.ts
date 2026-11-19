import { createRouter, webContext } from "../lib/hono";
import type { AppDeps } from "../app";
import { getSettings } from "../services/settings";
import { getStats } from "../services/stats";

export function createStatsRoutes(deps: AppDeps) {
  return createRouter().get("/", (c) => {
    const ctx = webContext(deps, c);
    const { streakMinMinutes } = getSettings(ctx);
    return c.json(getStats(ctx, { today: ctx.today, streakMinMinutes }));
  });
}

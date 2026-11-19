import { createRouter, webContext } from "../lib/hono";
import type { AppDeps } from "../app";
import { getSettings } from "../services/settings";
import { heatmapQuerySchema } from "../../shared/stats";
import { validate } from "../lib/validate";
import { getHeatmap, getStats } from "../services/stats";

export function createStatsRoutes(deps: AppDeps) {
  return createRouter()
    .get("/", (c) => {
      const ctx = webContext(deps, c);
      const { streakMinMinutes } = getSettings(ctx);
      return c.json(getStats(ctx, { today: ctx.today, streakMinMinutes }));
    })
    .get("/heatmap", validate("query", heatmapQuerySchema), (c) => {
      const ctx = webContext(deps, c);
      const { streakMinMinutes } = getSettings(ctx);
      const { year } = c.req.valid("query");
      return c.json(getHeatmap(ctx, { today: ctx.today, streakMinMinutes, year }));
    });
}

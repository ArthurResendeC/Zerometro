import { createRouter, webContext } from "../lib/hono";
import type { AppDeps } from "../app";
import { getSettings } from "../services/settings";
import { recapImageQuerySchema, recapQuerySchema } from "../../shared/recap";
import { statsPeriodSchema } from "../../shared/stats";
import { validate } from "../lib/validate";
import { getRecap } from "../services/recap";
import { getHeatmap, getPeriodBreakdown, getRecords, getRhythm, getStats } from "../services/stats";

export function createStatsRoutes(deps: AppDeps) {
  return createRouter()
    .get("/", (c) => {
      const ctx = webContext(deps, c);
      const { streakMinMinutes } = getSettings(ctx);
      return c.json(getStats(ctx, { today: ctx.today, streakMinMinutes }));
    })
    .get("/heatmap", validate("query", statsPeriodSchema), (c) => {
      const ctx = webContext(deps, c);
      const { streakMinMinutes } = getSettings(ctx);
      const { year } = c.req.valid("query");
      return c.json(getHeatmap(ctx, { today: ctx.today, streakMinMinutes, year }));
    })
    .get("/breakdown", validate("query", statsPeriodSchema), (c) => {
      const ctx = webContext(deps, c);
      const { year } = c.req.valid("query");
      return c.json(getPeriodBreakdown(ctx, { today: ctx.today, year }));
    })
    .get("/rhythm", validate("query", statsPeriodSchema), (c) => {
      const ctx = webContext(deps, c);
      const { year } = c.req.valid("query");
      return c.json(getRhythm(ctx, { today: ctx.today, timeZone: ctx.timeZone, year }));
    })
    .get("/records", validate("query", statsPeriodSchema), (c) => {
      const ctx = webContext(deps, c);
      const { year } = c.req.valid("query");
      return c.json(getRecords(ctx, { today: ctx.today, year }));
    })
    .get("/recap", validate("query", recapQuerySchema), (c) => {
      const ctx = webContext(deps, c);
      const { period, date } = c.req.valid("query");
      return c.json(getRecap(ctx, { today: ctx.today, timeZone: ctx.timeZone, period, date }));
    })
    .get("/recap/image", validate("query", recapImageQuerySchema), async (c) => {
      const ctx = webContext(deps, c);
      const { period, date, format } = c.req.valid("query");
      const recap = getRecap(ctx, { today: ctx.today, timeZone: ctx.timeZone, period, date });
      const png = await deps.recapImages.render(recap, format);
      const name = `zerometro-recap-${recap.period === "week" ? "semana" : "mes"}-${recap.from}-${format}.png`;
      return c.body(png, 200, {
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="${name}"`,
        // Muda a cada sessão registrada: cache curto, só no aparelho.
        "Cache-Control": "private, max-age=60",
      });
    });
}

import { Hono } from "hono";
import { updateSettingsSchema } from "../../shared/settings";
import type { AppDeps } from "../app";
import { validate } from "../lib/validate";
import { getSettings, updateSettings } from "../services/settings";

export function createSettingsRoutes(deps: AppDeps) {
  return new Hono()
    .get("/", (c) => c.json({ settings: getSettings(deps.db) }))
    .patch("/", validate("json", updateSettingsSchema), (c) => {
      const ctx = { db: deps.db, today: deps.today(), actor: "web" as const };
      return c.json({ settings: updateSettings(ctx, c.req.valid("json")) });
    });
}

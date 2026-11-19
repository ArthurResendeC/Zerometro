import { Hono } from "hono";
import { updateSettingsSchema } from "../../shared/settings";
import type { AppDeps } from "../app";
import { validate } from "../lib/validate";
import { createContext } from "../services/context";
import { getSettings, updateSettings } from "../services/settings";

export function createSettingsRoutes(deps: AppDeps) {
  return new Hono()
    .get("/", (c) => c.json({ settings: getSettings(deps.db) }))
    .patch("/", validate("json", updateSettingsSchema), (c) => {
      const ctx = createContext(deps.db, deps.clock, "web");
      return c.json({ settings: updateSettings(ctx, c.req.valid("json")) });
    });
}

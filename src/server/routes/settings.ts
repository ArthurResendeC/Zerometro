import { updateSettingsSchema } from "../../shared/settings";
import type { AppDeps } from "../app";
import { createRouter, webContext } from "../lib/hono";
import { validate } from "../lib/validate";
import { getSettings, updateSettings } from "../services/settings";

export function createSettingsRoutes(deps: AppDeps) {
  return createRouter()
    .get("/", (c) => c.json({ settings: getSettings(webContext(deps, c)) }))
    .patch("/", validate("json", updateSettingsSchema), (c) => {
      return c.json({ settings: updateSettings(webContext(deps, c), c.req.valid("json")) });
    });
}

import type { AppDeps } from "../app";
import { createRouter, webContext } from "../lib/hono";
import { getProfile } from "../services/profile";

export function createProfileRoutes(deps: AppDeps) {
  return createRouter().get("/", (c) => c.json(getProfile(webContext(deps, c))));
}

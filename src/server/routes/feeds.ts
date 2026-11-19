import type { AppDeps } from "../app";
import { createRouter } from "../lib/hono";

export function createFeedRoutes({ feeds }: Pick<AppDeps, "feeds">) {
  return createRouter().get("/", async (c) => c.json({ feeds: await feeds.getFeeds() }));
}

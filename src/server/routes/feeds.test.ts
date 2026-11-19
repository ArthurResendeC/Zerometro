import { describe, expect, test } from "bun:test";
import type { Feed } from "../../shared/feeds";
import { createFakeIgdb, createTestApp, fakeFeedGame } from "../testing";

describe("/api/feeds", () => {
  test("devolve as três listas da home", async () => {
    const igdb = createFakeIgdb([], { upcoming: [fakeFeedGame({ name: "Fable" })] });
    const { request } = await createTestApp({ igdb });

    const res = await request("/api/feeds");

    expect(res.status).toBe(200);
    const { feeds } = (await res.json()) as { feeds: Feed[] };
    expect(feeds.map((f) => [f.key, f.games.map((g) => g.name)])).toEqual([
      ["top_rated", []],
      ["trending", []],
      ["upcoming", ["Fable"]],
    ]);
  });

  test("exige login", async () => {
    const { app } = await createTestApp();
    expect((await app.request("/api/feeds")).status).toBe(401);
  });
});

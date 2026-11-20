import { describe, expect, test } from "bun:test";
import { achievementSourceUrl, parseSourceGameId } from "./achievements";

describe("parseSourceGameId", () => {
  test("aceita o número ou a URL da fonte", () => {
    expect(parseSourceGameId("steam", " 504230 ")).toBe(504230);
    expect(parseSourceGameId("steam", "https://store.steampowered.com/app/504230/Celeste/")).toBe(
      504230,
    );
    expect(parseSourceGameId("steam", "steamcommunity.com/stats/504230/achievements")).toBe(504230);
    expect(parseSourceGameId("retroachievements", "https://retroachievements.org/game/1446")).toBe(
      1446,
    );
  });

  test("recusa URL de outra fonte e lixo", () => {
    expect(parseSourceGameId("steam", "https://retroachievements.org/game/1446")).toBeNull();
    expect(parseSourceGameId("retroachievements", "store.steampowered.com/app/1")).toBeNull();
    expect(parseSourceGameId("steam", "celeste")).toBeNull();
    expect(parseSourceGameId("steam", "0")).toBeNull();
  });
});

test("achievementSourceUrl", () => {
  expect(achievementSourceUrl("steam", "504230")).toBe(
    "https://store.steampowered.com/app/504230/",
  );
  expect(achievementSourceUrl("retroachievements", "1446")).toBe(
    "https://retroachievements.org/game/1446",
  );
});

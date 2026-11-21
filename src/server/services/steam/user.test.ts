import { describe, expect, test } from "bun:test";
import { NotFoundError, SteamProfilePrivateError } from "../../errors";
import { createSteamUserApi, createSteamUserFromEnv } from "./user";

const STEAM_ID = "76561197960435530";

function setup(handler: (url: URL) => Response) {
  const urls: URL[] = [];
  const api = createSteamUserApi({
    apiKey: "chave",
    minIntervalMs: 0,
    sleep: async () => {},
    fetch: async (input) => {
      const url = new URL(input.toString());
      urls.push(url);
      return handler(url);
    },
  });
  return { api, urls };
}

const summaries = Response.json({
  response: {
    players: [
      {
        steamid: STEAM_ID,
        personaname: "Robin",
        profileurl: "https://steamcommunity.com/id/robinwalker/",
        avatarfull: "https://avatars.steamstatic.com/a_full.jpg",
      },
    ],
  },
});

describe("createSteamUserApi", () => {
  test("resolve a URL personalizada e traz o nome e o avatar", async () => {
    const { api, urls } = setup((url) =>
      url.pathname.includes("ResolveVanityURL")
        ? Response.json({ response: { steamid: STEAM_ID, success: 1 } })
        : summaries.clone(),
    );

    expect(await api.resolveProfile({ vanity: "robinwalker" })).toEqual({
      steamId: STEAM_ID,
      name: "Robin",
      avatarUrl: "https://avatars.steamstatic.com/a_full.jpg",
      profileUrl: "https://steamcommunity.com/id/robinwalker/",
    });
    expect(urls[0]?.searchParams.get("vanityurl")).toBe("robinwalker");
    expect(urls[1]?.searchParams.get("steamids")).toBe(STEAM_ID);
  });

  test("URL personalizada que não existe → NotFoundError", async () => {
    const { api } = setup(() => Response.json({ response: { success: 42, message: "No match" } }));
    await expect(api.resolveProfile({ vanity: "ninguem" })).rejects.toBeInstanceOf(NotFoundError);
  });

  test("conquistas: só as desbloqueadas, com a hora (0 vira null)", async () => {
    const { api, urls } = setup(() =>
      Response.json({
        playerstats: {
          success: true,
          achievements: [
            { apiname: "A", achieved: 1, unlocktime: 1_700_000_000 },
            { apiname: "B", achieved: 0, unlocktime: 0 },
            { apiname: "C", achieved: 1, unlocktime: 0 },
          ],
        },
      }),
    );

    expect(await api.getUnlocked(STEAM_ID, 504230)).toEqual([
      { apiName: "A", unlockedAt: new Date(1_700_000_000_000) },
      { apiName: "C", unlockedAt: null },
    ]);
    expect(urls[0]?.searchParams.get("appid")).toBe("504230");
  });

  test("perfil privado (403) → SteamProfilePrivateError; app sem conquistas (400) → null", async () => {
    const privateApi = setup(() =>
      Response.json(
        { playerstats: { error: "Profile is not public", success: false } },
        { status: 403 },
      ),
    ).api;
    await expect(privateApi.getUnlocked(STEAM_ID, 440)).rejects.toBeInstanceOf(
      SteamProfilePrivateError,
    );

    const noStats = setup(() =>
      Response.json(
        { playerstats: { error: "Requested app has no stats", success: false } },
        { status: 400 },
      ),
    ).api;
    expect(await noStats.getUnlocked(STEAM_ID, 1)).toBeNull();
  });

  test("jogos da conta com as horas, filtrados pelos appids", async () => {
    const { api, urls } = setup(() =>
      Response.json({
        response: {
          game_count: 1,
          games: [
            {
              appid: 504230,
              name: "Celeste",
              playtime_forever: 765,
              playtime_2weeks: 30,
              rtime_last_played: 1_700_000_000,
            },
          ],
        },
      }),
    );

    expect(await api.getOwnedGames(STEAM_ID, [504230, 440])).toEqual([
      {
        appId: 504230,
        name: "Celeste",
        minutes: 765,
        recentMinutes: 30,
        lastPlayedAt: new Date(1_700_000_000_000),
      },
    ]);
    expect(urls[0]?.searchParams.get("include_appinfo")).toBe("1");
    expect(urls[0]?.searchParams.get("appids_filter[0]")).toBe("504230");
    expect(urls[0]?.searchParams.get("appids_filter[1]")).toBe("440");
  });

  test("jogos com perfil privado (resposta vazia) → SteamProfilePrivateError", async () => {
    const { api } = setup(() => Response.json({ response: {} }));
    await expect(api.getOwnedGames(STEAM_ID)).rejects.toBeInstanceOf(SteamProfilePrivateError);
  });

  test("sem chave: desligada", async () => {
    const api = createSteamUserFromEnv({ STEAM_WEB_API_KEY: undefined });
    expect(api.enabled).toBe(false);
    await expect(api.getOwnedGames(STEAM_ID)).rejects.toThrow("STEAM_WEB_API_KEY");
  });
});

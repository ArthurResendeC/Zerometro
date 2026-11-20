import { describe, expect, test } from "bun:test";
import { AchievementSourceNotConfiguredError } from "../../errors";
import { createSteamApi, createSteamFromEnv } from "./index";

const schema = {
  game: {
    gameName: "Celeste",
    availableGameStats: {
      achievements: [
        {
          name: "ACH_1",
          displayName: "Pegou o morango",
          description: "Pegue um morango",
          hidden: 0,
          icon: "https://cdn.steam/1.jpg",
          icongray: "https://cdn.steam/1g.jpg",
        },
        { name: "ACH_SECRET", displayName: "Segredo", hidden: 1, icon: "https://cdn.steam/2.jpg" },
      ],
    },
  },
};

function setup(routes: { schema?: unknown; percentages?: unknown; percentagesStatus?: number }) {
  const urls: URL[] = [];
  const api = createSteamApi({
    apiKey: "chave",
    minIntervalMs: 0,
    sleep: async () => {},
    fetch: async (input) => {
      const url = new URL(input.toString());
      urls.push(url);
      if (url.pathname.includes("GetSchemaForGame")) return Response.json(routes.schema ?? {});
      if (routes.percentagesStatus) return new Response(null, { status: routes.percentagesStatus });
      return Response.json(routes.percentages ?? {});
    },
  });
  return { api, urls };
}

describe("createSteamApi", () => {
  test("junta o schema em português com a raridade global", async () => {
    const { api, urls } = setup({
      schema,
      percentages: {
        achievementpercentages: {
          achievements: [
            { name: "ACH_1", percent: "61.5" },
            { name: "ACH_SECRET", percent: 3.2 },
          ],
        },
      },
    });

    const set = await api.getAchievementSet(504230);

    expect(set).toEqual({
      source: "steam",
      externalId: "504230",
      title: "Celeste",
      platform: null,
      achievements: [
        {
          externalId: "ACH_1",
          title: "Pegou o morango",
          description: "Pegue um morango",
          iconUrl: "https://cdn.steam/1.jpg",
          iconLockedUrl: "https://cdn.steam/1g.jpg",
          rarity: 61.5,
          points: null,
          hidden: false,
          sortOrder: 0,
        },
        {
          externalId: "ACH_SECRET",
          title: "Segredo",
          description: null,
          iconUrl: "https://cdn.steam/2.jpg",
          iconLockedUrl: null,
          rarity: 3.2,
          points: null,
          hidden: true,
          sortOrder: 1,
        },
      ],
    });
    const schemaUrl = urls.find((u) => u.pathname.includes("GetSchemaForGame"))!;
    expect(Object.fromEntries(schemaUrl.searchParams)).toEqual({
      key: "chave",
      appid: "504230",
      l: "brazilian",
    });
  });

  test("sem a raridade (erro da Steam), a lista sai sem ela", async () => {
    const { api } = setup({ schema, percentagesStatus: 403 });

    const set = await api.getAchievementSet(504230);
    expect(set?.achievements.map((a) => a.rarity)).toEqual([null, null]);
  });

  test("app sem conquistas (ou inexistente) devolve null", async () => {
    expect(await setup({ schema: { game: {} } }).api.getAchievementSet(1)).toBeNull();
    expect(await setup({ schema: {} }).api.getAchievementSet(1)).toBeNull();
  });

  test("nome interno da Valve não vira título", async () => {
    const { api } = setup({ schema: { game: { ...schema.game, gameName: "ValveTestApp504230" } } });
    expect((await api.getAchievementSet(504230))?.title).toBeNull();
  });
});

describe("createSteamFromEnv", () => {
  test("sem chave fica desligada e explica o que falta", async () => {
    const api = createSteamFromEnv({ STEAM_WEB_API_KEY: "" });
    expect(api.enabled).toBe(false);
    await expect(api.getAchievementSet(1)).rejects.toBeInstanceOf(
      AchievementSourceNotConfiguredError,
    );
  });
});

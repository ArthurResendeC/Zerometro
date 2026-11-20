import { describe, expect, test } from "bun:test";
import { AchievementSourceNotConfiguredError } from "../../errors";
import { createRetroAchievementsApi, createRetroAchievementsFromEnv } from "./index";

function setup(body: unknown) {
  const urls: URL[] = [];
  const api = createRetroAchievementsApi({
    apiKey: "chave-ra",
    minIntervalMs: 0,
    sleep: async () => {},
    fetch: async (input) => {
      urls.push(new URL(input.toString()));
      return Response.json(body);
    },
  });
  return { api, urls };
}

describe("createRetroAchievementsApi", () => {
  test("getAchievementSet: ordem de exibição, badges e raridade pelos jogadores", async () => {
    const { api, urls } = setup({
      ID: 1446,
      Title: "Super Metroid",
      ConsoleName: "SNES/Super Famicom",
      NumDistinctPlayers: 200,
      Achievements: {
        "9": {
          ID: 9,
          Title: "Kraid",
          Points: 10,
          BadgeName: "111",
          DisplayOrder: 2,
          NumAwarded: 50,
        },
        "8": {
          ID: 8,
          Title: "Morph Ball",
          Description: "Pegue a Morph Ball",
          Points: 5,
          BadgeName: "110",
          DisplayOrder: 1,
          NumAwarded: 180,
        },
      },
    });

    const set = await api.getAchievementSet(1446);

    expect(set?.title).toBe("Super Metroid");
    expect(set?.platform).toBe("SNES/Super Famicom");
    expect(set?.achievements).toEqual([
      {
        externalId: "8",
        title: "Morph Ball",
        description: "Pegue a Morph Ball",
        iconUrl: "https://media.retroachievements.org/Badge/110.png",
        iconLockedUrl: "https://media.retroachievements.org/Badge/110_lock.png",
        rarity: 90,
        points: 5,
        hidden: false,
        sortOrder: 0,
      },
      expect.objectContaining({ externalId: "9", rarity: 25, description: null, sortOrder: 1 }),
    ]);
    expect(urls[0]?.pathname).toBe("/API/API_GetGameExtended.php");
    expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({ y: "chave-ra", i: "1446" });
  });

  test("jogo sem conquistas ou inexistente devolve null", async () => {
    expect(
      await setup({ ID: 1, Title: "X", Achievements: [] }).api.getAchievementSet(1),
    ).toBeNull();
    expect(await setup({}).api.getAchievementSet(1)).toBeNull();
    expect(await setup(null).api.getAchievementSet(1)).toBeNull();
  });

  test("getGameList: só jogos com conquistas, sem hashes", async () => {
    const { api, urls } = setup([
      {
        ID: 1446,
        Title: "Super Metroid",
        ConsoleID: 3,
        ConsoleName: "SNES/Super Famicom",
        ImageIcon: "/Images/066352.png",
        NumAchievements: 50,
        Points: 400,
      },
    ]);

    expect(await api.getGameList(3)).toEqual([
      {
        id: 1446,
        title: "Super Metroid",
        consoleId: 3,
        consoleName: "SNES/Super Famicom",
        iconUrl: "https://media.retroachievements.org/Images/066352.png",
        achievements: 50,
        points: 400,
      },
    ]);
    expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({ y: "chave-ra", i: "3", f: "1" });
  });
});

describe("createRetroAchievementsFromEnv", () => {
  test("sem chave fica desligado e explica o que falta", async () => {
    const api = createRetroAchievementsFromEnv({ RA_API_KEY: undefined });
    expect(api.enabled).toBe(false);
    await expect(api.getGameList(3)).rejects.toBeInstanceOf(AchievementSourceNotConfiguredError);
  });
});

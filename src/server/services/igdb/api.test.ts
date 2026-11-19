import { describe, expect, test } from "bun:test";
import { createIgdbApi } from "./api";
import type { IgdbClient } from "./client";

/** Client falso: responde por endpoint e registra as queries Apicalypse. */
function fakeClient(responses: Record<string, unknown[]>) {
  const queries: { endpoint: string; body: string }[] = [];
  const client: IgdbClient = {
    async query<T>(endpoint: string, body: string) {
      queries.push({ endpoint, body });
      return (responses[endpoint] ?? []) as T;
    },
  };
  return { client, queries };
}

describe("searchGames", () => {
  test("filtra edições/DLCs, escapa aspas e mapeia os campos", async () => {
    const { client, queries } = fakeClient({
      games: [
        {
          id: 1029,
          name: "The Legend of Zelda: Ocarina of Time",
          slug: "the-legend-of-zelda-ocarina-of-time",
          cover: { image_id: "co3nnx" },
          platforms: [{ name: "Nintendo 64", abbreviation: "N64" }, { name: "Sem abreviação" }],
          genres: [{ name: "Adventure" }],
          first_release_date: 911_606_400, // 1998-11-21
          game_type: 0,
        },
      ],
    });

    const results = await createIgdbApi(client).searchGames('say "hi"', 5);

    expect(queries[0]!.body).toContain('search "say \\"hi\\"";');
    expect(queries[0]!.body).toContain("where version_parent = null & game_type = (");
    expect(queries[0]!.body).toContain("limit 20;"); // pede candidatos extras para reordenar
    expect(results).toEqual([
      {
        igdbId: 1029,
        name: "The Legend of Zelda: Ocarina of Time",
        slug: "the-legend-of-zelda-ocarina-of-time",
        coverImageId: "co3nnx",
        platforms: ["N64", "Sem abreviação"],
        genres: ["Adventure"],
        releaseYear: 1998,
        gameType: "Jogo",
      },
    ]);
  });

  test("ordena por popularidade, mantendo a ordem da busca nos empates", async () => {
    const { client } = fakeClient({
      games: [
        { id: 1, name: "Fan game", total_rating_count: 2 },
        { id: 2, name: "Original", total_rating_count: 900 },
        { id: 3, name: "Sem nota A" },
        { id: 4, name: "Sem nota B" },
      ],
    });

    const results = await createIgdbApi(client).searchGames("x");

    expect(results.map((r) => r.igdbId)).toEqual([2, 1, 3, 4]);

    // O corte do limit acontece depois de ordenar.
    const top = await createIgdbApi(client).searchGames("x", 1);
    expect(top.map((r) => r.igdbId)).toEqual([2]);
  });

  test("rejeita limit não inteiro (vai direto na query)", async () => {
    const { client } = fakeClient({});
    await expect(createIgdbApi(client).searchGames("x", 1.5)).rejects.toThrow(TypeError);
  });
});

describe("getGame", () => {
  test("retorna detalhes com tempo para zerar", async () => {
    const { client, queries } = fakeClient({
      games: [{ id: 12517, name: "Undertale", game_type: 0 }],
      game_time_to_beats: [{ game_id: 12517, hastily: 15428, normally: 29997, completely: 46628 }],
    });

    const game = await createIgdbApi(client).getGame(12517);

    expect(queries[1]!.body).toContain("where game_id = (12517);");
    expect(game?.timeToBeat).toEqual({ mainSec: 15428, extraSec: 29997, completeSec: 46628 });
  });

  test("edição sem tempo próprio herda o do jogo base", async () => {
    const { client, queries } = fakeClient({
      games: [{ id: 134222, name: "Persona 5 Royal: Launch Edition", version_parent: 114283 }],
      game_time_to_beats: [{ game_id: 114283, hastily: 315000 }],
    });

    const game = await createIgdbApi(client).getGame(134222);

    expect(queries[1]!.body).toContain("where game_id = (134222,114283);");
    expect(game?.timeToBeat).toEqual({ mainSec: 315000, extraSec: null, completeSec: null });
  });

  test("sem tempo para zerar → null; jogo inexistente → null", async () => {
    const semTempo = fakeClient({ games: [{ id: 1, name: "Obscuro" }] });
    expect((await createIgdbApi(semTempo.client).getGame(1))?.timeToBeat).toBeNull();

    const vazio = fakeClient({});
    expect(await createIgdbApi(vazio.client).getGame(999)).toBeNull();
  });
});

describe("getFeed", () => {
  const now = new Date("2026-11-19T18:00:00.000Z");
  const nowSec = Math.floor(now.getTime() / 1000);

  test("bem avaliados: janela de 120 dias, mínimo de notas e campos da lista", async () => {
    const { client, queries } = fakeClient({
      games: [
        {
          id: 381247,
          name: "Ace Combat 8",
          slug: "ace-combat-8",
          cover: { image_id: "co1" },
          first_release_date: 1_791_331_200, // 2026-10-07
          game_type: 0,
          aggregated_rating: 90.6,
          aggregated_rating_count: 5,
          hypes: 58,
          release_dates: [
            { date: 1_791_331_200, date_format: 0 },
            { date: 1_800_000_000, date_format: 1 },
          ],
        },
      ],
    });

    const [game] = await createIgdbApi(client).getFeed("top_rated", now);

    const body = queries[0]!.body;
    expect(body).toContain(`first_release_date > ${nowSec - 120 * 86_400}`);
    expect(body).toContain(`first_release_date <= ${nowSec}`);
    expect(body).toContain("aggregated_rating_count >= 3");
    expect(body).toContain("game_type = (0,8,9) & version_parent = null & cover != null");
    expect(body).toContain("sort aggregated_rating desc;");
    expect(game).toMatchObject({
      igdbId: 381247,
      criticRating: 91,
      criticRatingCount: 5,
      hypes: 58,
      releaseDate: "2026-10-07",
      releasePrecision: "day",
    });
  });

  test("próximos: ordena por expectativa e lê a precisão da data", async () => {
    const { client, queries } = fakeClient({
      games: [
        {
          id: 194662,
          name: "The Witcher IV",
          first_release_date: 1_861_833_600, // 2028-12-31: só o ano é conhecido
          hypes: 292,
          release_dates: [{ date: 1_861_833_600, date_format: 2 }],
        },
        { id: 1, name: "Sem data" },
      ],
    });

    const games = await createIgdbApi(client).getFeed("upcoming", now);

    expect(queries[0]!.body).toContain(`first_release_date > ${nowSec} & hypes > 0`);
    expect(queries[0]!.body).toContain("sort hypes desc;");
    expect(games[0]).toMatchObject({ releaseDate: "2028-12-31", releasePrecision: "year" });
    expect(games[1]).toMatchObject({
      criticRating: null,
      criticRatingCount: 0,
      hypes: 0,
      releaseDate: null,
      releasePrecision: null,
    });
  });

  test('em alta: mais "quero jogar", na ordem de popularidade, só os lançados no último ano', async () => {
    const { client, queries } = fakeClient({
      popularity_primitives: [{ game_id: 3 }, { game_id: 1 }, { game_id: 3 }, { game_id: 2 }],
      // O IGDB devolve fora de ordem e já sem o jogo 2 (filtrado por data/tipo).
      games: [
        { id: 1, name: "Segundo" },
        { id: 3, name: "Primeiro" },
      ],
    });

    const games = await createIgdbApi(client).getFeed("trending", now);

    expect(queries[0]!.endpoint).toBe("popularity_primitives");
    expect(queries[0]!.body).toContain("where popularity_type = 2; sort value desc;");
    expect(queries[1]!.body).toContain("where id = (3,1,2)");
    expect(queries[1]!.body).toContain(`first_release_date > ${nowSec - 365 * 86_400}`);
    expect(queries[1]!.body).toContain(`first_release_date <= ${nowSec}`);
    expect(games.map((g) => g.name)).toEqual(["Primeiro", "Segundo"]);
  });

  test("em alta sem dados de popularidade não consulta jogos", async () => {
    const { client, queries } = fakeClient({});
    expect(await createIgdbApi(client).getFeed("trending", now)).toEqual([]);
    expect(queries).toHaveLength(1);
  });
});

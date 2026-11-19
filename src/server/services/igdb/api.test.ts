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

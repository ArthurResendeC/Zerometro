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

  test("pede external_games e pega o appid da Steam", async () => {
    const { client, queries } = fakeClient({
      games: [
        {
          id: 26226,
          name: "Celeste",
          external_games: [
            { uid: "abc", external_game_source: 5 },
            { uid: "504230", external_game_source: 1 },
          ],
        },
      ],
    });

    const game = await createIgdbApi(client).getGame(26226);

    expect(queries[0]!.body).toContain("external_games.uid, external_games.external_game_source");
    expect(game?.steamAppId).toBe(504230);
  });

  test("sem Steam em external_games → steamAppId null", async () => {
    const { client } = fakeClient({ games: [{ id: 1, name: "Super Metroid" }] });
    expect((await createIgdbApi(client).getGame(1))?.steamAppId).toBeNull();
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

/** Jogo citado dentro de outro (parecidos, série…), com capa. */
const ref = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  cover: { image_id: `co${id}` },
  ...extra,
});
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const year = (y: number) => Date.parse(`${y}-06-01T00:00:00Z`) / 1000;

describe("getGamePage", () => {
  test("busca tudo numa query e mapeia os campos da página", async () => {
    const { client, queries } = fakeClient({
      games: [
        {
          id: 119133,
          name: "Elden Ring",
          slug: "elden-ring",
          summary: "  Elden Ring is an action RPG.  ",
          storyline: "",
          aggregated_rating: 96.9,
          aggregated_rating_count: 10,
          rating: 93.4,
          rating_count: 2351,
          game_status: 0,
          involved_companies: [
            { company: { name: "Bandai Namco" }, developer: false, publisher: true },
            { company: { name: "FromSoftware" }, developer: true, publisher: true },
          ],
          themes: [{ name: "Fantasy" }, { name: "Open world" }],
          game_modes: [{ name: "Single player" }],
          player_perspectives: [{ name: "Third person" }],
          game_engines: [{ name: "Dantelion" }],
          videos: [
            { video_id: "a", name: "Gameplay" },
            { video_id: "b", name: "Trailer" },
            { video_id: "c", name: "Launch Trailer" },
            { video_id: "d" },
          ],
          websites: [
            { url: "https://reddit.com/r/Eldenring", type: 14 },
            { url: "https://store.steampowered.com/app/1245620", type: 13 },
            { url: "https://store.steampowered.com/outra", type: 13 },
            { url: "https://desconhecido", type: 99 },
            { url: "https://eldenring.com", type: 1 },
          ],
          language_supports: [
            { language: { name: "Portuguese (Brazil)" }, language_support_type: 3 },
            { language: { name: "English" }, language_support_type: 1 },
            { language: { name: "Portuguese (Brazil)" }, language_support_type: 2 },
          ],
          age_ratings: [
            { organization: 1, rating_category: { rating: "M" } },
            { organization: 6, rating_category: { rating: "16" } },
          ],
          artworks: [
            { image_id: "retrato", width: 600, height: 800, artwork_type: 2 },
            { image_id: "faixa", width: 5981, height: 920, artwork_type: 1 },
            { image_id: "logo", width: 4321, height: 2495, artwork_type: 7 },
            { image_id: "transparente", width: 3840, height: 2160, alpha_channel: true },
            { image_id: "com-logo", width: 3840, height: 2160, artwork_type: 3 },
            { image_id: "sem-tipo", width: 1920, height: 1080 },
            { image_id: "artwork", width: 2560, height: 1440, artwork_type: 1 },
            { image_id: "arte-principal", width: 1920, height: 620, artwork_type: 2 },
          ],
          screenshots: Array.from({ length: 15 }, (_, i) => ({ image_id: `sc${i}` })),
          expansions: [ref(240009, "Shadow of the Erdtree")],
          dlcs: [ref(415376, "Tarnished Pack")],
          similar_games: [ref(2155, "Dark Souls"), ref(2155, "Dark Souls"), { id: 9 }],
        },
      ],
      game_time_to_beats: [{ game_id: 119133, hastily: 156960, count: 28 }],
    });

    const page = await createIgdbApi(client).getGamePage(119133);

    expect(queries).toHaveLength(2);
    expect(queries[0]!.body).toContain("where id = 119133; limit 1;");
    expect(queries[0]!.body).toContain("collections.games.cover.image_id");
    expect(queries[1]!.body).toContain("count; where game_id = (119133);");
    expect(page).toMatchObject({
      igdbId: 119133,
      summary: "Elden Ring is an action RPG.",
      storyline: null,
      criticRating: 97,
      criticRatingCount: 10,
      userRating: 93,
      userRatingCount: 2351,
      status: null,
      developers: ["FromSoftware"],
      publishers: ["Bandai Namco", "FromSoftware"],
      themes: ["Fantasy", "Open world"],
      gameModes: ["Single player"],
      perspectives: ["Third person"],
      engines: ["Dantelion"],
      heroImageId: "arte-principal",
      ageRating: { org: "classind", rating: "16" },
      timeToBeat: { mainSec: 156960, extraSec: null, completeSec: null },
      timeToBeatCount: 28,
      parentGame: null,
    });
    expect(page!.screenshotIds).toHaveLength(12);
    expect(page!.videos.map((v) => v.youtubeId)).toEqual(["c", "b", "a", "d"]);
    expect(page!.videos[3]!.name).toBe("Vídeo");
    // Um por tipo, na ordem das lojas primeiro; tipo desconhecido sai.
    expect(page!.links).toEqual([
      { kind: "steam", url: "https://store.steampowered.com/app/1245620" },
      { kind: "official", url: "https://eldenring.com" },
      { kind: "reddit", url: "https://reddit.com/r/Eldenring" },
    ]);
    expect(page!.languages).toEqual([
      { name: "English", audio: true, subtitles: false, interface: false },
      { name: "Portuguese (Brazil)", audio: false, subtitles: true, interface: true },
    ]);
    expect(page!.related.expansions.map((g) => g.name)).toEqual(["Shadow of the Erdtree"]);
    expect(page!.related.dlcs[0]).toEqual({
      igdbId: 415376,
      name: "Tarnished Pack",
      slug: null,
      coverImageId: "co415376",
      releaseYear: null,
    });
    // Sem repetidos e sem os que vieram sem nome.
    expect(page!.related.similar.map((g) => g.igdbId)).toEqual([2155]);
  });

  test("banner: sem artwork largo usa a 1ª screenshot; sem imagens, null", async () => {
    const comScreenshot = fakeClient({
      games: [
        {
          id: 1,
          name: "Retratos",
          artworks: [{ image_id: "quadrado", width: 800, height: 800 }],
          screenshots: [{ image_id: "sc1" }, { image_id: "sc2" }],
        },
      ],
    });
    expect((await createIgdbApi(comScreenshot.client).getGamePage(1))?.heroImageId).toBe("sc1");

    const semImagens = fakeClient({ games: [{ id: 2, name: "Nada" }] });
    expect((await createIgdbApi(semImagens.client).getGamePage(2))?.heroImageId).toBeNull();
  });

  test("lançamentos: uma data por plataforma (Brasil > mundial), agrupadas e em ordem", async () => {
    const { client } = fakeClient({
      games: [
        {
          id: 1,
          name: "Multi",
          release_dates: [
            {
              date: day("2022-02-25"),
              platform: { name: "PlayStation 5", abbreviation: "PS5" },
              release_region: 8,
            },
            {
              date: day("2022-02-25"),
              platform: { name: "PC (Microsoft Windows)", abbreviation: "PC" },
              release_region: 8,
            },
            // Japão saiu antes, mas a data mundial é a preferida.
            {
              date: day("2022-02-20"),
              platform: { name: "PC (Microsoft Windows)", abbreviation: "PC" },
              release_region: 5,
            },
            // No Brasil saiu depois: vale a do Brasil.
            {
              date: day("2022-03-01"),
              platform: { name: "Xbox Series X|S", abbreviation: "Series X|S" },
              release_region: 8,
            },
            {
              date: day("2022-02-01"),
              platform: { name: "Xbox Series X|S", abbreviation: "Series X|S" },
              release_region: 10,
            },
            // Acesso antecipado de quem comprou a edição especial: o lançamento completo vale.
            {
              date: day("2022-02-18"),
              platform: { name: "PlayStation 5", abbreviation: "PS5" },
              release_region: 10,
              status: 34,
            },
            // Só o ano, sem abreviação.
            { date: day("2026-12-31"), date_format: 2, platform: { name: "Nintendo Switch 2" } },
            // A definir: fica de fora.
            {
              date: day("2027-12-31"),
              date_format: 7,
              platform: { name: "Mac", abbreviation: "Mac" },
            },
            { platform: { name: "Linux", abbreviation: "Linux" } },
          ],
        },
      ],
    });

    const page = await createIgdbApi(client).getGamePage(1);

    expect(page!.releases).toEqual([
      { date: "2022-02-01", precision: "day", platforms: ["Series X|S"] },
      { date: "2022-02-25", precision: "day", platforms: ["PS5", "PC"] },
      { date: "2026-12-31", precision: "year", platforms: ["Nintendo Switch 2"] },
    ]);
  });

  test("série: jogos principais da coleção e da franquia, sem repetir nem o próprio jogo", async () => {
    const { client } = fakeClient({
      games: [
        {
          id: 10,
          name: "Jogo 2",
          parent_game: ref(1, "Original"),
          collections: [
            {
              games: [
                ref(10, "Jogo 2", { game_type: 0, first_release_date: year(2015) }),
                ref(12, "Jogo 3", { game_type: 0, first_release_date: year(2020) }),
                ref(11, "Jogo 1", { game_type: 0, first_release_date: year(2010) }),
                ref(13, "DLC", { game_type: 1, first_release_date: year(2016) }),
                ref(14, "Edição GOTY", { game_type: 0, version_parent: 10 }),
                ref(15, "Remake do 1", { game_type: 8, first_release_date: year(2023) }),
              ],
            },
          ],
          franchises: [
            { games: [ref(11, "Jogo 1", { game_type: 0, first_release_date: year(2010) })] },
            { games: [ref(16, "Sem tipo")] },
          ],
        },
      ],
    });

    const page = await createIgdbApi(client).getGamePage(10);

    expect(page!.related.series.map((g) => g.name)).toEqual(["Jogo 1", "Jogo 3", "Remake do 1"]);
    expect(page!.related.series[0]!.releaseYear).toBe(2010);
    expect(page!.parentGame).toMatchObject({ igdbId: 1, name: "Original" });
  });

  test("jogo obscuro: listas vazias e nulos; status do IGDB vira selo", async () => {
    const { client } = fakeClient({
      games: [{ id: 372563, name: "Demake", game_status: 6 }],
    });

    const page = await createIgdbApi(client).getGamePage(372563);

    expect(page).toMatchObject({
      summary: null,
      storyline: null,
      criticRating: null,
      userRating: null,
      userRatingCount: 0,
      status: "cancelled",
      developers: [],
      releases: [],
      heroImageId: null,
      screenshotIds: [],
      videos: [],
      links: [],
      languages: [],
      ageRating: null,
      timeToBeat: null,
      timeToBeatCount: 0,
      parentGame: null,
      related: { expansions: [], dlcs: [], remakes: [], series: [], similar: [] },
    });
  });

  test("edição herda o tempo do jogo base; jogo inexistente → null", async () => {
    const edicao = fakeClient({
      games: [{ id: 2, name: "Edição", version_parent: 1 }],
      game_time_to_beats: [{ game_id: 1, hastily: 3600, count: 5 }],
    });
    const page = await createIgdbApi(edicao.client).getGamePage(2);
    expect(page).toMatchObject({ timeToBeat: { mainSec: 3600 }, timeToBeatCount: 5 });

    const vazio = fakeClient({});
    expect(await createIgdbApi(vazio.client).getGamePage(999)).toBeNull();
  });
});

describe("getGamePage: banner", () => {
  test("sem arte principal: artwork comum mais largo; só logotipos → screenshot", async () => {
    const comum = fakeClient({
      games: [
        {
          id: 1,
          name: "Comum",
          artworks: [
            { image_id: "conceito", width: 3840, height: 2160, artwork_type: 4 },
            { image_id: "menor", width: 1280, height: 720, artwork_type: 1 },
            { image_id: "maior", width: 2560, height: 1440 },
          ],
        },
      ],
    });
    expect((await createIgdbApi(comum.client).getGamePage(1))?.heroImageId).toBe("maior");

    const soLogos = fakeClient({
      games: [
        {
          id: 2,
          name: "Só logos",
          artworks: [{ image_id: "logo", width: 3840, height: 2160, artwork_type: 6 }],
          screenshots: [{ image_id: "sc1" }],
        },
      ],
    });
    expect((await createIgdbApi(soLogos.client).getGamePage(2))?.heroImageId).toBe("sc1");
  });
});

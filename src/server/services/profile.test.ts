import { beforeEach, describe, expect, test } from "bun:test";
import { sortProfileRows } from "../../shared/profile";
import { createFakeIgdb, createTestContext, fakeIgdbGame, TEST_TODAY } from "../testing";
import { markCompleted } from "./completions";
import type { ServiceContext } from "./context";
import { addToLibrary, updateLibraryEntry } from "./library";
import { getProfile } from "./profile";
import { logSession } from "./sessions";

const sandfall = { igdbId: 1, name: "Sandfall Interactive", developer: true, publisher: false };
const kepler = { igdbId: 2, name: "Kepler Interactive", developer: false, publisher: true };
const supergiant = { igdbId: 3, name: "Supergiant Games", developer: true, publisher: true };

const igdb = createFakeIgdb([
  fakeIgdbGame({
    igdbId: 305152,
    name: "Clair Obscur: Expedition 33",
    genres: ["Role-playing (RPG)"],
    themes: ["Fantasy"],
    companies: [sandfall, kepler],
    collections: [],
    franchises: [],
  }),
  fakeIgdbGame({
    igdbId: 113112,
    name: "Hades",
    genres: ["Role-playing (RPG)", "Indie"],
    themes: ["Action"],
    companies: [supergiant],
    // Série + sub-série com os mesmos jogos da biblioteca: vira uma linha só, a de nome curto.
    collections: [
      { igdbId: 50, name: "Hades" },
      { igdbId: 51, name: "Hades: Edições" },
    ],
    // Nas franquias, junta os nomes (o mais curto não é necessariamente o mais amplo).
    franchises: [
      { igdbId: 60, name: "Mitologia grega" },
      { igdbId: 61, name: "Supergiant" },
    ],
  }),
  fakeIgdbGame({
    igdbId: 228525,
    name: "Hades II",
    genres: ["Indie"],
    themes: ["Action"],
    companies: [supergiant],
    collections: [
      { igdbId: 51, name: "Hades: Edições" },
      { igdbId: 50, name: "Hades" },
    ],
    franchises: [],
  }),
  fakeIgdbGame({ igdbId: 999, name: "Desejo intocado", companies: [kepler] }),
]);

let ctx: ServiceContext;
const ids: Record<string, number> = {};

beforeEach(async () => {
  ctx = createTestContext();
  ids.e33 = (await addToLibrary(ctx, igdb, { igdbId: 305152, status: "playing" })).gameId;
  ids.hades = (await addToLibrary(ctx, igdb, { igdbId: 113112, status: "playing" })).gameId;
  ids.hades2 = (await addToLibrary(ctx, igdb, { igdbId: 228525, status: "playing" })).gameId;
  await addToLibrary(ctx, igdb, { igdbId: 999, status: "wishlist" });

  logSession(ctx, { gameId: ids.e33!, minutes: 600, playedOn: TEST_TODAY });
  logSession(ctx, { gameId: ids.hades!, minutes: 300, playedOn: TEST_TODAY });
  logSession(ctx, { gameId: ids.hades2!, minutes: 200, playedOn: TEST_TODAY });
  markCompleted(ctx, ids.hades!, { type: "main" });
  updateLibraryEntry(ctx, ids.e33!, { rating: 10, platformPlayed: "PC" });
  updateLibraryEntry(ctx, ids.hades!, { rating: 8 });
  updateLibraryEntry(ctx, ids.hades2!, { rating: 9 });
});

describe("getProfile", () => {
  test("dev e publisher em rankings separados; desejo intocado fica de fora", () => {
    const profile = getProfile(ctx);

    expect(profile.gamesCounted).toBe(3);
    expect(profile.totalMinutes).toBe(1100);
    expect(profile.developers.map((r) => [r.name, r.minutes, r.games])).toEqual([
      ["Sandfall Interactive", 600, 1],
      ["Supergiant Games", 500, 2],
    ]);
    // Kepler só publicou: não aparece como dev, e o desejo intocado não soma.
    expect(profile.publishers.map((r) => [r.name, r.minutes, r.games])).toEqual([
      ["Kepler Interactive", 600, 1],
      ["Supergiant Games", 500, 2],
    ]);
  });

  test("séries, gêneros e plataformas com zerados, nota média e capas", () => {
    const profile = getProfile(ctx);

    expect(profile.series).toEqual([
      expect.objectContaining({
        name: "Hades",
        minutes: 500,
        games: 2,
        finished: 1,
        avgRating: 8.5,
        ratedGames: 2,
      }),
    ]);
    expect(profile.series[0]!.topGames.map((g) => g.name)).toEqual(["Hades", "Hades II"]);
    expect(profile.franchises.map((r) => [r.name, r.games])).toEqual([
      ["Supergiant · Mitologia grega", 1],
    ]);
    expect(profile.genres.map((r) => [r.name, r.minutes])).toEqual([
      ["Role-playing (RPG)", 900],
      ["Indie", 500],
    ]);
    expect(profile.platforms.map((r) => r.name)).toEqual(["PC"]);
  });
});

describe("sortProfileRows", () => {
  test("por nota exige 2 jogos com nota; por zerados, só quem zerou", () => {
    const { developers } = getProfile(ctx);

    // Sandfall tem nota 10, mas num jogo só: não entra na ordem por nota.
    expect(sortProfileRows(developers, "rating").map((r) => r.name)).toEqual(["Supergiant Games"]);
    expect(sortProfileRows(developers, "finished").map((r) => r.name)).toEqual([
      "Supergiant Games",
    ]);
    expect(sortProfileRows(developers, "minutes").map((r) => r.name)).toEqual([
      "Sandfall Interactive",
      "Supergiant Games",
    ]);
  });
});

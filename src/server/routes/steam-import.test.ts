import { describe, expect, test } from "bun:test";
import type { LibraryItem } from "../../shared/library";
import type {
  SteamAutoSync,
  SteamImportPreview,
  SteamImportResult,
  SteamLibrarySync,
} from "../../shared/steam";
import { createFakeIgdb, createFakeSteamUser, createTestApp, fakeIgdbGame } from "../testing";

const P5R = 1687950;
const CELESTE = 504230;
const HOLLOW_KNIGHT = 367520;
const HADES = 1145360;
const WALLPAPER_ENGINE = 431960;

const igdb = () =>
  createFakeIgdb([
    fakeIgdbGame(),
    fakeIgdbGame({ igdbId: 26226, name: "Celeste", steamAppId: CELESTE, platforms: ["PC", "NSW"] }),
    fakeIgdbGame({ igdbId: 14593, name: "Hollow Knight", steamAppId: HOLLOW_KNIGHT }),
    fakeIgdbGame({ igdbId: 113112, name: "Hades", steamAppId: HADES }),
  ]);

/** P5R jogado este mês, Hollow Knight há tempos, Celeste nunca, Hades já na biblioteca. */
const steamUser = (options: { private?: boolean } = {}) =>
  createFakeSteamUser({
    ...options,
    owned: {
      [P5R]: { minutes: 3000, lastPlayedAt: new Date("2026-11-10T22:00:00Z"), name: "P5R" },
      [HOLLOW_KNIGHT]: {
        minutes: 600,
        lastPlayedAt: new Date("2025-01-05T22:00:00Z"),
        name: "Hollow Knight",
      },
      [CELESTE]: { minutes: 0, lastPlayedAt: null, name: "Celeste" },
      [HADES]: 90,
      [WALLPAPER_ENGINE]: { minutes: 1200, lastPlayedAt: null, name: "Wallpaper Engine" },
    },
    unlocked: { [P5R]: [{ apiName: "ACH_1", unlockedAt: new Date("2026-05-01T20:00:00Z") }] },
  });

function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function setup(options: { linked?: boolean; private?: boolean } = {}) {
  const app = await createTestApp({ igdb: igdb(), steamUser: steamUser(options) });
  const { request } = app;
  await request("/api/library", json({ igdbId: 113112, status: "finished" }));
  if (options.linked !== false) {
    await request("/api/steam/profile", json({ profile: "robinwalker" }, "PUT"));
  }
  const preview = async () => {
    const res = await request("/api/steam/import");
    return { status: res.status, body: (await res.json()) as SteamImportPreview };
  };
  const importGames = async (body: unknown) =>
    (await (await request("/api/steam/import", json(body))).json()) as SteamImportResult;
  const library = async () =>
    ((await (await request("/api/library")).json()) as { items: LibraryItem[] }).items;
  return { ...app, preview, importGames, library };
}

describe("/api/steam/import", () => {
  test("prévia: os da conta fora da biblioteca, mais jogados primeiro, com o status sugerido", async () => {
    const { preview } = await setup();
    const { status, body } = await preview();

    expect(status).toBe(200);
    expect(
      body.candidates.map((c) => [c.name, c.appId, c.minutes, c.suggestedStatus, c.ignored]),
    ).toEqual([
      ["Persona 5 Royal", P5R, 3000, "playing", false],
      ["Hollow Knight", HOLLOW_KNIGHT, 600, "backlog", false],
      ["Celeste", CELESTE, 0, "backlog", false],
    ]);
    // O nome da Steam só vem quando é outro.
    expect(body.candidates.map((c) => c.steamName)).toEqual(["P5R", null, null]);
    expect(body.unmatched).toEqual([
      { appId: WALLPAPER_ENGINE, name: "Wallpaper Engine", minutes: 1200 },
    ]);
    expect(body.inLibrary).toBe(1);
    expect(body.hidesPlaytime).toBe(false);
  });

  test("importa com o tempo da Steam, guarda os desmarcados e traz as conquistas em lotes", async () => {
    const { request, preview, importGames, library } = await setup();

    const result = await importGames({
      games: [
        { appId: P5R, status: "playing" },
        { appId: HOLLOW_KNIGHT, status: "paused" },
      ],
      ignore: [CELESTE],
    });
    expect(result.added.map((a) => [a.name, a.appId])).toEqual([
      ["Persona 5 Royal", P5R],
      ["Hollow Knight", HOLLOW_KNIGHT],
    ]);
    expect(result).toMatchObject({ skipped: [], ignored: 1 });

    const items = await library();
    const p5r = items.find((i) => i.name === "Persona 5 Royal")!;
    expect(p5r).toMatchObject({
      status: "playing",
      startedAt: "2026-11-19",
      playtimeSource: "steam",
      platformPlayed: "PC",
      // As horas ficam valendo quando as conquistas forem buscadas.
      steamPlaytime: null,
    });
    expect(items.find((i) => i.name === "Hollow Knight")?.status).toBe("paused");

    const sync = await request(
      "/api/steam/sync/games",
      json({ gameIds: result.added.map((a) => a.gameId) }),
    );
    const synced = (await sync.json()) as SteamLibrarySync;
    const byName = synced.games.toSorted((a, b) => a.name.localeCompare(b.name));
    expect(byName.map((g) => [g.name, g.steamMinutes, g.newUnlocks])).toEqual([
      ["Hollow Knight", 600, 0],
      ["Persona 5 Royal", 3000, 1],
    ]);
    // Só esses jogos: o Hades (que já estava) não foi tocado, e o relógio da automática não mudou.
    expect(synced.games.some((g) => g.name === "Hades")).toBe(false);
    expect(await (await request("/api/steam/profile")).json()).toMatchObject({ auto: null });
    expect((await library()).find((i) => i.name === "Persona 5 Royal")).toMatchObject({
      minutesPlayed: 3000,
      achievements: { total: 3, unlocked: 1 },
    });

    // Na próxima prévia: os importados somem, o Celeste vem como ignorado.
    const { body } = await preview();
    expect(body.candidates.map((c) => [c.name, c.ignored])).toEqual([["Celeste", true]]);
    expect(body.inLibrary).toBe(3);

    // Importar um ignorado tira ele da lista.
    const celeste = await importGames({ games: [{ appId: CELESTE, status: "backlog" }] });
    expect(celeste).toMatchObject({ ignored: 0 });
    expect(celeste.added).toHaveLength(1);
  });

  test("sem buscar as conquistas, a sincronização automática termina o serviço", async () => {
    const { request, importGames, library } = await setup();
    await importGames({ games: [{ appId: P5R, status: "playing" }] });

    const auto = (await (
      await request("/api/steam/sync/auto", { method: "POST" })
    ).json()) as SteamAutoSync;
    expect(auto.games.find((g) => g.appId === P5R)).toMatchObject({ newUnlocks: 1 });
    expect((await library()).find((i) => i.name === "Persona 5 Royal")?.minutesPlayed).toBe(3000);
  });

  test("pula o que já está, o que saiu da conta e o que o IGDB não conhece", async () => {
    const { importGames, library } = await setup();
    const result = await importGames({
      games: [
        { appId: HADES, status: "playing" },
        { appId: 999, status: "playing" },
        { appId: WALLPAPER_ENGINE, status: "playing" },
      ],
    });
    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual([
      { appId: HADES, reason: "Já está na biblioteca" },
      { appId: 999, reason: "Não está na sua conta Steam" },
      { appId: WALLPAPER_ENGINE, reason: "O IGDB não conhece esse jogo" },
    ]);
    expect(await library()).toHaveLength(1);
  });

  test("desconectar esquece os ignorados", async () => {
    const { request, preview, importGames } = await setup();
    await importGames({ games: [], ignore: [CELESTE] });
    await request("/api/steam/profile", { method: "DELETE" });
    await request("/api/steam/profile", json({ profile: "robinwalker" }, "PUT"));
    const { body } = await preview();
    expect(body.candidates.find((c) => c.appId === CELESTE)?.ignored).toBe(false);
  });

  test("sem perfil → 409; perfil privado → erro claro; corpo inválido → 400", async () => {
    const unlinked = await setup({ linked: false });
    expect((await unlinked.preview()).status).toBe(409);

    const hidden = await setup({ private: true });
    const res = await hidden.request("/api/steam/import");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.json()).toMatchObject({ error: { code: "steam_profile_private" } });

    const bad = await hidden.request(
      "/api/steam/import",
      json({ games: [{ appId: -1, status: "x" }] }),
    );
    expect(bad.status).toBe(400);
    const tooMany = await hidden.request(
      "/api/steam/sync/games",
      json({ gameIds: Array.from({ length: 51 }, (_, i) => i + 1) }),
    );
    expect(tooMany.status).toBe(400);
  });
});

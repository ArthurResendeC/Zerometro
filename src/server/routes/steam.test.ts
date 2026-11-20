import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { GameAchievements } from "../../shared/achievements";
import type { LibraryItem } from "../../shared/library";
import type {
  SteamAutoSync,
  SteamAutoSyncState,
  SteamGameSync,
  SteamLibrarySync,
  SteamProfile,
} from "../../shared/steam";
import { games } from "../db/schema";
import { createSteamUserFromEnv } from "../services/steam/user";
import {
  createFakeIgdb,
  createFakeSteamUser,
  createTestApp,
  createTestClock,
  FAKE_STEAM_ID,
  fakeIgdbGame,
  TEST_NOW,
} from "../testing";

const P5R = 1687950;

function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

type Request = Awaited<ReturnType<typeof createTestApp>>["request"];

async function addP5r(request: Request) {
  const created = await request("/api/library", json({ igdbId: 114283, status: "playing" }));
  return ((await created.json()) as { item: LibraryItem }).item;
}

const linkProfile = (request: Request) =>
  request("/api/steam/profile", json({ profile: "steamcommunity.com/id/robinwalker" }, "PUT"));

describe("/api/steam/profile", () => {
  test("ligar pela URL, ler e desligar", async () => {
    const { request } = await createTestApp();
    expect(await (await request("/api/steam/profile")).json()).toEqual({
      enabled: true,
      profile: null,
      auto: null,
    });

    const linked = await linkProfile(request);
    expect(linked.status).toBe(200);
    const { profile } = (await linked.json()) as { profile: SteamProfile };
    expect(profile).toMatchObject({ steamId: FAKE_STEAM_ID, name: "Robin" });
    expect(
      ((await (await request("/api/steam/profile")).json()) as { profile: SteamProfile }).profile,
    ).toEqual(profile);

    const unlinked = await request("/api/steam/profile", { method: "DELETE" });
    expect(await unlinked.json()).toEqual({ enabled: true, profile: null, auto: null });
  });

  test("texto que não é perfil → 400; perfil que não existe → 404; sem chave → 503", async () => {
    const { request } = await createTestApp();
    const invalid = await request("/api/steam/profile", json({ profile: "não é perfil" }, "PUT"));
    expect(invalid.status).toBe(400);
    const missing = await request("/api/steam/profile", json({ profile: "ninguem" }, "PUT"));
    expect(missing.status).toBe(404);

    const off = await createTestApp({ steamUser: createSteamUserFromEnv({}) });
    expect(await (await off.request("/api/steam/profile")).json()).toMatchObject({
      enabled: false,
    });
    expect((await linkProfile(off.request)).status).toBe(503);
  });
});

/** Conta com o P5R (50h) e duas conquistas desbloqueadas (uma sem data). */
const steamUser = () =>
  createFakeSteamUser({
    owned: { [P5R]: 3000 },
    unlocked: {
      [P5R]: [
        { apiName: "ACH_1", unlockedAt: new Date("2026-05-01T20:00:00Z") },
        { apiName: "ACH_2", unlockedAt: null },
      ],
    },
  });

describe("sincronizar com a Steam", () => {
  test("sem perfil ligado → 409 steam_not_linked", async () => {
    const { request } = await createTestApp({ steamUser: steamUser() });
    const item = await addP5r(request);
    const res = await request(`/api/library/${item.gameId}/steam/sync`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "steam_not_linked" } });
  });

  test("um jogo: liga a lista da Steam, traz desbloqueios com a data e as horas", async () => {
    const { request } = await createTestApp({ steamUser: steamUser() });
    const item = await addP5r(request);
    await linkProfile(request);

    const res = await request(`/api/library/${item.gameId}/steam/sync`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sync: SteamGameSync;
      item: LibraryItem;
      achievements: GameAchievements;
    };
    expect(body.sync).toMatchObject({
      appId: P5R,
      owned: true,
      steamMinutes: 3000,
      newUnlocks: 2,
      linkedSet: true,
      error: null,
    });
    const unlocked = body.achievements.sets[0]!.achievements.filter((a) => a.unlockedAt);
    expect(unlocked.map((a) => [a.title, a.unlockedAt, a.origin])).toEqual([
      ["Primeiro palácio", "2026-05-01T20:00:00.000Z", "sync"],
      // Sem data na Steam: vale a hora da sincronização.
      ["Confidente máximo", "2026-11-19T18:00:00.000Z", "sync"],
    ]);

    // O tempo da Steam fica à parte; o total continua o das sessões até escolher a Steam.
    expect(body.item).toMatchObject({
      minutesPlayed: 0,
      playtimeSource: "sessions",
      steamPlaytime: { minutes: 3000, syncedAt: "2026-11-19T18:00:00.000Z" },
    });

    // De novo: nada novo (os desbloqueios já estão lá).
    const again = await request(`/api/library/${item.gameId}/steam/sync`, { method: "POST" });
    expect(((await again.json()) as { sync: SteamGameSync }).sync.newUnlocks).toBe(0);
  });

  test("não desmarca o que foi marcado à mão", async () => {
    const { request } = await createTestApp({ steamUser: steamUser() });
    const item = await addP5r(request);
    await linkProfile(request);
    const base = `/api/library/${item.gameId}/achievements`;
    const { sets } = (await (
      await request(`${base}/sets`, json({ source: "steam", id: String(P5R) }))
    ).json()) as GameAchievements;
    const secret = sets[0]!.achievements.find((a) => a.title === "Final verdadeiro")!;
    await request(`${base}/${secret.id}`, json({ unlocked: true }, "PATCH"));

    await request(`/api/library/${item.gameId}/steam/sync`, { method: "POST" });
    const after = (await (await request(base)).json()) as GameAchievements;
    expect(after.summary).toMatchObject({ total: 3, unlocked: 3 });
    expect(after.sets[0]!.achievements.find((a) => a.id === secret.id)?.origin).toBe("manual");
  });

  test("escolher a Steam como fonte do tempo jogado (só depois de sincronizar)", async () => {
    const { request } = await createTestApp({ steamUser: steamUser() });
    const item = await addP5r(request);
    const entry = `/api/library/${item.gameId}`;

    const early = await request(entry, json({ playtimeSource: "steam" }, "PATCH"));
    expect(early.status).toBe(400);

    await linkProfile(request);
    await request(`${entry}/steam/sync`, { method: "POST" });
    await request(entry, json({ priorMinutes: 120 }, "PATCH"));
    const steam = await request(entry, json({ playtimeSource: "steam" }, "PATCH"));
    expect(((await steam.json()) as { item: LibraryItem }).item).toMatchObject({
      minutesPlayed: 3000,
      priorMinutes: 120,
      playtimeSource: "steam",
    });

    // Voltar para o controle manual: o tempo anterior continua lá.
    const manual = await request(entry, json({ playtimeSource: "sessions" }, "PATCH"));
    expect(((await manual.json()) as { item: LibraryItem }).item).toMatchObject({
      minutesPlayed: 120,
      playtimeSource: "sessions",
    });
  });

  test("tudo: só os jogos na Steam; perfil privado → 409", async () => {
    const { request } = await createTestApp({ steamUser: steamUser() });
    await addP5r(request);
    await linkProfile(request);

    const res = await request("/api/steam/sync", { method: "POST" });
    const body = (await res.json()) as SteamLibrarySync;
    expect(body.newUnlocks).toBe(2);
    expect(body.games.map((g) => [g.name, g.steamMinutes])).toEqual([["Persona 5 Royal", 3000]]);

    const closed = await createTestApp({ steamUser: createFakeSteamUser({ private: true }) });
    await addP5r(closed.request);
    await linkProfile(closed.request);
    const denied = await closed.request("/api/steam/sync", { method: "POST" });
    expect(denied.status).toBe(409);
    expect(await denied.json()).toMatchObject({ error: { code: "steam_profile_private" } });
  });
});

/** `n` minutos depois de TEST_NOW. */
const minutes = (n: number) => new Date(TEST_NOW.getTime() + n * 60_000);

/** App com o P5R na biblioteca e o perfil ligado; `auto` chama a sincronização automática. */
async function setupAuto(options: Parameters<typeof createFakeSteamUser>[0]) {
  const clock = createTestClock();
  const fake = createFakeSteamUser(options);
  const app = await createTestApp({ steamUser: fake, clock });
  const item = await addP5r(app.request);
  await linkProfile(app.request);
  fake.calls.length = 0;
  const auto = async () =>
    (await (await app.request("/api/steam/sync/auto", { method: "POST" })).json()) as SteamAutoSync;
  const libraryItem = async () =>
    ((await (await app.request(`/api/library/${item.gameId}`)).json()) as { item: LibraryItem })
      .item;
  return { ...app, clock, fake, item, auto, libraryItem };
}

describe("sincronização automática (ao abrir o app)", () => {
  test("sem perfil: pula sem chamar a Steam", async () => {
    const fake = createFakeSteamUser({ owned: { [P5R]: 3000 } });
    const { request } = await createTestApp({ steamUser: fake });
    const res = await request("/api/steam/sync/auto", { method: "POST" });
    expect(await res.json()).toEqual({ status: "skipped", games: [], newUnlocks: 0, state: null });
    expect(fake.calls).toEqual([]);
  });

  test("primeira vez busca tudo; dentro do intervalo pula; depois, só o que mudou", async () => {
    const owned = { [P5R]: 3000 };
    const { auto, clock, fake, libraryItem } = await setupAuto({
      owned,
      unlocked: { [P5R]: [{ apiName: "ACH_1", unlockedAt: null }] },
    });

    const first = await auto();
    expect(first).toMatchObject({
      status: "synced",
      newUnlocks: 1,
      state: { lastRunAt: TEST_NOW.toISOString(), lastError: null },
    });
    expect(first.games.map((g) => g.name)).toEqual(["Persona 5 Royal"]);
    expect(fake.calls).toEqual(["owned:", "unlocked:1687950"]);

    // 29 minutos depois (outra aba, outro aparelho): nem pergunta à Steam.
    fake.calls.length = 0;
    clock.set(minutes(29));
    expect((await auto()).status).toBe("skipped");
    expect(fake.calls).toEqual([]);

    // Passou o intervalo e não jogou: só confere as horas.
    clock.set(minutes(31));
    const quiet = await auto();
    expect(quiet).toMatchObject({ status: "synced", games: [], newUnlocks: 0 });
    expect(fake.calls).toEqual(["owned:"]);
    expect((await libraryItem()).steamPlaytime).toEqual({
      minutes: 3000,
      syncedAt: minutes(31).toISOString(),
    });

    // Jogou mais: busca as conquistas desse jogo.
    fake.calls.length = 0;
    owned[P5R] = 3090;
    clock.set(minutes(62));
    const played = await auto();
    expect(played.games.map((g) => [g.name, g.steamMinutes])).toEqual([["Persona 5 Royal", 3090]]);
    expect(fake.calls).toEqual(["owned:", "unlocked:1687950"]);
  });

  test("jogou depois da última sincronização (mesmas horas): busca as conquistas", async () => {
    const owned: Record<number, { minutes: number; lastPlayedAt: Date | null }> = {
      [P5R]: { minutes: 3000, lastPlayedAt: new Date("2026-05-01T20:00:00Z") },
    };
    const { auto, clock, fake } = await setupAuto({ owned });
    await auto();

    clock.set(minutes(40));
    owned[P5R] = { minutes: 3000, lastPlayedAt: minutes(35) };
    fake.calls.length = 0;
    expect((await auto()).games).toHaveLength(1);
    expect(fake.calls).toEqual(["owned:", "unlocked:1687950"]);
  });

  test("perfil que esconde o tempo de jogo: só os jogos que está jogando", async () => {
    const celeste = fakeIgdbGame({ igdbId: 26226, name: "Celeste", steamAppId: 504230 });
    const clock = createTestClock();
    const { request } = await createTestApp({
      clock,
      igdb: createFakeIgdb([fakeIgdbGame(), celeste]),
      steamUser: createFakeSteamUser({ owned: { [P5R]: 0, 504230: 0 } }),
    });
    await addP5r(request);
    await request("/api/library", json({ igdbId: 26226, status: "backlog" }));
    await linkProfile(request);
    const auto = async () =>
      (await (await request("/api/steam/sync/auto", { method: "POST" })).json()) as SteamAutoSync;

    // Nunca sincronizados: os dois.
    expect((await auto()).games.map((g) => g.name).toSorted()).toEqual([
      "Celeste",
      "Persona 5 Royal",
    ]);
    clock.set(minutes(31));
    expect((await auto()).games.map((g) => g.name)).toEqual(["Persona 5 Royal"]);
  });

  test("perfil privado: não estoura, guarda o erro, e uma sincronização que dá certo limpa", async () => {
    const options = { owned: { [P5R]: 3000 }, private: true };
    const { auto, clock, item, request } = await setupAuto(options);

    const failed = await auto();
    expect(failed).toMatchObject({
      status: "failed",
      state: { lastError: { message: expect.stringContaining("Detalhes dos jogos") } },
    });
    const profile = (await (await request("/api/steam/profile")).json()) as {
      auto: SteamAutoSyncState;
    };
    expect(profile.auto.lastError?.at).toBe(TEST_NOW.toISOString());

    // Arrumou o perfil e sincronizou o jogo na mão: o erro some, o relógio continua.
    options.private = false;
    clock.set(minutes(5));
    await request(`/api/library/${item.gameId}/steam/sync`, { method: "POST" });
    const after = (await (await request("/api/steam/profile")).json()) as {
      auto: SteamAutoSyncState;
    };
    expect(after.auto).toEqual({ lastRunAt: TEST_NOW.toISOString(), lastError: null });
  });

  test('"Sincronizar tudo" zera o relógio; perfil novo começa do zero', async () => {
    const { auto, clock, fake, request } = await setupAuto({ owned: { [P5R]: 3000 } });
    await request("/api/steam/sync", { method: "POST" });
    fake.calls.length = 0;
    clock.set(minutes(10));
    expect((await auto()).status).toBe("skipped");

    await linkProfile(request);
    expect((await auto()).status).toBe("synced");
    expect(fake.calls).toContain("owned:");
  });
});

describe("onSteam: o jogo está na Steam?", () => {
  const metroid = fakeIgdbGame({ igdbId: 1103, name: "Super Metroid", steamAppId: null });

  async function setupOnSteam() {
    const app = await createTestApp({ igdb: createFakeIgdb([fakeIgdbGame(), metroid]) });
    const p5r = await addP5r(app.request);
    const created = await app.request("/api/library", json({ igdbId: 1103, status: "backlog" }));
    const snes = ((await created.json()) as { item: LibraryItem }).item;
    const onSteam = async (gameId: number) =>
      ((await (await app.request(`/api/library/${gameId}`)).json()) as { item: LibraryItem }).item
        .onSteam;
    return { ...app, p5r, snes, onSteam };
  }

  test("pelo IGDB: com o app da Steam sim, sem ele não", async () => {
    const { p5r, snes, onSteam } = await setupOnSteam();
    expect(await onSteam(p5r.gameId)).toBe(true);
    expect(await onSteam(snes.gameId)).toBe(false);
  });

  test("IGDB ainda não consultado sobre a Steam → null", async () => {
    const { db, snes, onSteam } = await setupOnSteam();
    db.update(games).set({ steamCheckedAt: null }).where(eq(games.id, snes.gameId)).run();
    expect(await onSteam(snes.gameId)).toBeNull();
  });

  test("seguir uma lista da Steam colada à mão conta, mesmo sem o app no IGDB", async () => {
    const { request, snes, onSteam } = await setupOnSteam();
    await request(
      `/api/library/${snes.gameId}/achievements/sets`,
      json({ source: "steam", id: String(P5R) }),
    );
    expect(await onSteam(snes.gameId)).toBe(true);
  });
});

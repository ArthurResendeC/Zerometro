import { describe, expect, test } from "bun:test";
import type { GameAchievements } from "../../shared/achievements";
import type { LibraryItem } from "../../shared/library";
import type { SteamGameSync, SteamLibrarySync, SteamProfile } from "../../shared/steam";
import { createSteamUserFromEnv } from "../services/steam/user";
import { createFakeSteamUser, createTestApp, FAKE_STEAM_ID } from "../testing";

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
    });

    const linked = await linkProfile(request);
    expect(linked.status).toBe(200);
    const { profile } = (await linked.json()) as { profile: SteamProfile };
    expect(profile).toMatchObject({ steamId: FAKE_STEAM_ID, name: "Robin" });
    expect(
      ((await (await request("/api/steam/profile")).json()) as { profile: SteamProfile }).profile,
    ).toEqual(profile);

    const unlinked = await request("/api/steam/profile", { method: "DELETE" });
    expect(await unlinked.json()).toEqual({ enabled: true, profile: null });
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

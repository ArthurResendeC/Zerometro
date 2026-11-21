import { describe, expect, test } from "bun:test";
import type { LibraryItem } from "../../shared/library";
import type { PlaySessionItem } from "../../shared/sessions";
import type { Stats } from "../../shared/stats";
import type { SteamGameSync } from "../../shared/steam";
import { libraryEntries } from "../db/schema";
import { resetSteamBaselines } from "../services/steam-playtime";
import { runSteamSyncJob } from "../services/steam-sync-job";
import { createFakeSteamUser, createTestApp, createTestClock, TEST_NOW } from "../testing";

// Horas da Steam viram sessões: o que for jogado depois da primeira sincronização entra na
// ofensiva e nas estatísticas. TEST_NOW = 19/11/2026 15h em São Paulo.

const P5R = 1687950;

function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

const hours = (n: number) => new Date(TEST_NOW.getTime() + n * 3_600_000);

type Owned = Record<number, number | { minutes: number; lastPlayedAt: Date | null }>;

async function setup(options: { source?: "steam" | "sessions"; owned?: Owned } = {}) {
  const owned: Owned = options.owned ?? { [P5R]: 3000 };
  const clock = createTestClock();
  const fake = createFakeSteamUser({ owned });
  const app = await createTestApp({ steamUser: fake, clock });
  const { request } = app;
  const created = await request("/api/library", json({ igdbId: 114283, status: "paused" }));
  const item = ((await created.json()) as { item: LibraryItem }).item;
  await request(
    "/api/steam/profile",
    json({ profile: "steamcommunity.com/id/robinwalker" }, "PUT"),
  );
  const entry = `/api/library/${item.gameId}`;
  const sync = async () =>
    (
      (await (await request(`${entry}/steam/sync`, { method: "POST" })).json()) as {
        sync: SteamGameSync;
      }
    ).sync;
  // Primeira sincronização: marca a base (as 50h viram "antes").
  await sync();
  await request(entry, json({ playtimeSource: options.source ?? "steam" }, "PATCH"));
  const sessions = async () =>
    (
      (await (await request(`/api/sessions?gameId=${item.gameId}`)).json()) as {
        sessions: PlaySessionItem[];
      }
    ).sessions;
  const libraryItem = async () =>
    ((await (await request(entry)).json()) as { item: LibraryItem }).item;
  return { ...app, clock, owned, item, entry, sync, sessions, libraryItem };
}

const summary = (sessions: PlaySessionItem[]) =>
  sessions.map((s) => [s.playedOn, s.minutes, s.source]).toSorted();

describe("horas da Steam viram sessões", () => {
  test("a primeira sincronização só marca a base; o que vier depois vira sessão", async () => {
    const { clock, owned, sync, sessions, libraryItem, request } = await setup();
    expect(await sessions()).toEqual([]);

    clock.set(hours(3));
    owned[P5R] = 3090;
    const result = await sync();
    expect(result.sessionMinutes).toBe(90);
    expect(summary(await sessions())).toEqual([["2026-11-19", 90, "steam"]]);

    // Total continua o da Steam; voltou a jogar um pausado → Jogando; entra na ofensiva.
    expect(await libraryItem()).toMatchObject({ minutesPlayed: 3090, status: "playing" });
    const stats = (await (await request("/api/stats")).json()) as Stats;
    expect(stats.streak.current).toBe(1);

    // Sincronizar de novo sem jogar não cria nada.
    clock.set(hours(4));
    expect((await sync()).sessionMinutes).toBe(0);
    expect(await sessions()).toHaveLength(1);
  });

  test("vai para o dia em que jogou por último", async () => {
    const { clock, owned, sync, sessions } = await setup();
    clock.set(hours(24 * 2));
    owned[P5R] = { minutes: 3060, lastPlayedAt: hours(20) }; // 20/11 11h em SP
    await sync();
    expect(summary(await sessions())).toEqual([["2026-11-20", 60, "steam"]]);
  });

  test("o timer e os registros do jogo desde a base são descontados", async () => {
    const { clock, owned, sync, sessions, item, request } = await setup();
    await request("/api/timer/start", json({ gameId: item.gameId }));
    clock.set(hours(1));
    await request("/api/timer/stop", json({}));
    await request("/api/sessions", json({ gameId: item.gameId, minutes: 20 }));

    clock.set(hours(2));
    owned[P5R] = 3100; // 100 na Steam: 60 do timer + 20 do registro + 20 sem registro
    expect((await sync()).sessionMinutes).toBe(20);
    expect(summary(await sessions())).toEqual([
      ["2026-11-19", 20, "manual"],
      ["2026-11-19", 20, "steam"],
      ["2026-11-19", 60, "timer"],
    ]);

    // Tudo registrado pelo timer: a Steam não acrescenta nada.
    await request("/api/timer/start", json({ gameId: item.gameId }));
    clock.set(hours(3));
    await request("/api/timer/stop", json({}));
    clock.set(hours(4));
    owned[P5R] = 3160;
    expect((await sync()).sessionMinutes).toBe(0);
  });

  test("com o timer rodando no jogo, espera ele parar", async () => {
    const { clock, owned, sync, sessions, item, request } = await setup();
    await request("/api/timer/start", json({ gameId: item.gameId }));
    clock.set(hours(1));
    owned[P5R] = 3060;
    expect((await sync()).sessionMinutes).toBe(0);

    clock.set(hours(2));
    await request("/api/timer/stop", json({}));
    owned[P5R] = 3120;
    clock.set(hours(3));
    expect((await sync()).sessionMinutes).toBe(0);
    expect(summary(await sessions())).toEqual([["2026-11-19", 120, "timer"]]);
  });

  test("jogo com as sessões como fonte do tempo: a base avança sem criar sessão", async () => {
    const { clock, owned, sync, sessions, entry, request } = await setup({ source: "sessions" });
    clock.set(hours(1));
    owned[P5R] = 3060;
    expect((await sync()).sessionMinutes).toBe(0);

    // Trocou para a Steam: só o que vier daqui em diante.
    await request(entry, json({ playtimeSource: "steam" }, "PATCH"));
    clock.set(hours(2));
    owned[P5R] = 3075;
    expect((await sync()).sessionMinutes).toBe(15);
    expect(summary(await sessions())).toEqual([["2026-11-19", 15, "steam"]]);
  });

  test("tempo escondido na Steam (total 0) não mexe na base", async () => {
    const { clock, owned, sync, sessions } = await setup();
    clock.set(hours(1));
    owned[P5R] = 0;
    await sync();
    clock.set(hours(2));
    owned[P5R] = 3030;
    expect((await sync()).sessionMinutes).toBe(30);
    expect(summary(await sessions())).toEqual([["2026-11-19", 30, "steam"]]);
  });

  test("mais de 24h desde a base: o que não cabe no dia volta para os anteriores", async () => {
    const { clock, owned, sync, sessions } = await setup();
    clock.set(hours(24 * 2)); // 21/11
    owned[P5R] = 3000 + 30 * 60;
    await sync();
    expect(summary(await sessions())).toEqual([
      ["2026-11-20", 360, "steam"],
      ["2026-11-21", 1440, "steam"],
    ]);
  });

  test("a sincronização automática também cria as sessões", async () => {
    const { clock, owned, sessions, request } = await setup();
    clock.set(hours(1));
    owned[P5R] = 3045;
    await request("/api/steam/sync/auto", { method: "POST" });
    expect(summary(await sessions())).toEqual([["2026-11-19", 45, "steam"]]);
  });

  test("perfil de outra conta: a próxima sincronização só marca a base", async () => {
    const { clock, owned, sync, sessions, db, item, userId } = await setup();
    resetSteamBaselines(db, userId);
    clock.set(hours(1));
    owned[P5R] = 9000;
    expect((await sync()).sessionMinutes).toBe(0);
    expect(await sessions()).toEqual([]);
    expect(db.select().from(libraryEntries).get()).toMatchObject({
      gameId: item.gameId,
      steamCountedMinutes: 9000,
    });
  });

  test("o job de hora em hora sincroniza quem tem perfil ligado", async () => {
    const app = await setup();
    const { clock, owned, sessions, db, achievements, igdb, steamUser } = app;
    clock.set(hours(1));
    owned[P5R] = 3030;
    await runSteamSyncJob(db, clock, { catalog: achievements, igdb, steamUser });
    expect(summary(await sessions())).toEqual([["2026-11-19", 30, "steam"]]);
  });
});

import { beforeEach, describe, expect, test } from "bun:test";
import { createTestDb, type Db } from "../db/client";
import { NotFoundError } from "../errors";
import { createFakeIgdb, createTestContext, fakeIgdbGame, TEST_TODAY } from "../testing";
import type { ServiceContext } from "./context";
import { addToLibrary, getLibraryItem, listLibrary, removeFromLibrary } from "./library";
import { deleteSession, listSessions, logSession } from "./sessions";
import { getSettings, updateSettings } from "./settings";
import { getStats } from "./stats";
import { getActiveSession, startTimer } from "./timer";

// Cada convidado só enxerga e mexe nos próprios dados; o cache de jogos é compartilhado.

const igdb = createFakeIgdb([fakeIgdbGame()]);
let db: Db;
let dono: ServiceContext;
let amigo: ServiceContext;
let gameId: number;

beforeEach(async () => {
  db = createTestDb();
  dono = createTestContext({ db });
  amigo = createTestContext({ db, userId: "user-amigo" });
  gameId = (await addToLibrary(dono, igdb, { igdbId: 114283, status: "playing" })).gameId;
});

describe("isolamento entre usuários", () => {
  test("biblioteca: o mesmo jogo em duas bibliotecas, cada uma com seu status", async () => {
    expect(listLibrary(amigo)).toEqual([]);
    expect(() => getLibraryItem(amigo, gameId)).toThrow(NotFoundError);

    const doAmigo = await addToLibrary(amigo, igdb, { igdbId: 114283, status: "wishlist" });
    expect(doAmigo.gameId).toBe(gameId); // mesmo cache do IGDB
    expect(getLibraryItem(dono, gameId).status).toBe("playing");
    expect(getLibraryItem(amigo, gameId).status).toBe("wishlist");

    removeFromLibrary(amigo, gameId);
    expect(listLibrary(dono)).toHaveLength(1);
  });

  test("sessões, totais e estatísticas são de cada um", async () => {
    await addToLibrary(amigo, igdb, { igdbId: 114283, status: "playing" });
    const { session } = logSession(dono, { gameId, minutes: 60 });
    logSession(amigo, { gameId, minutes: 15 });

    expect(listSessions(amigo).map((s) => s.minutes)).toEqual([15]);
    expect(getLibraryItem(dono, gameId).minutesPlayed).toBe(60);
    expect(getStats(amigo, { today: TEST_TODAY, streakMinMinutes: 10 }).todayMinutes).toBe(15);
    // O limite de 24h por dia também é por pessoa.
    expect(() => logSession(amigo, { gameId, minutes: 1400 })).not.toThrow();

    expect(() => deleteSession(amigo, session.id)).toThrow(NotFoundError);
  });

  test("sem a entrada na biblioteca, não dá para registrar no jogo de outro", () => {
    expect(() => logSession(amigo, { gameId, minutes: 30 })).toThrow(NotFoundError);
  });

  test("cada um pode ter um timer rodando", async () => {
    await addToLibrary(amigo, igdb, { igdbId: 114283, status: "playing" });
    startTimer(dono, { gameId });
    startTimer(amigo, { gameId });

    expect(getActiveSession(dono)?.id).not.toBe(getActiveSession(amigo)?.id);
  });

  test("ajustes são por usuário", () => {
    updateSettings(amigo, { streakMinMinutes: 120 });
    expect(getSettings(amigo).streakMinMinutes).toBe(120);
    expect(getSettings(dono).streakMinMinutes).toBe(30);
  });
});

import { beforeEach, describe, expect, test } from "bun:test";
import { createTestDb, type Db } from "../db/client";
import { NotFoundError, TimerActiveError, ValidationError } from "../errors";
import {
  createFakeIgdb,
  createTestClock,
  createTestUser,
  fakeIgdbGame,
  TEST_USER_ID,
} from "../testing";
import { createContext } from "./context";
import { addToLibrary, getLibraryItem } from "./library";
import { listSessions, logSession, updateSession } from "./sessions";
import { getStats } from "./stats";
import { cancelTimer, getActiveSession, startTimer, stopTimer } from "./timer";

// Horários em São Paulo (UTC-3): "2026-11-19T18:00Z" = 15:00 local.
const at = (local: string) => new Date(`${local}:00-03:00`);

const igdb = createFakeIgdb([
  fakeIgdbGame(),
  fakeIgdbGame({ igdbId: 12517, name: "Undertale", timeToBeat: null }),
]);

let db: Db;
let clock: ReturnType<typeof createTestClock>;
let persona: number;
let undertale: number;
const ctx = () => createContext(db, clock, "web", TEST_USER_ID);

beforeEach(async () => {
  db = createTestDb();
  createTestUser(db);
  clock = createTestClock(at("2026-11-19T15:00"));
  persona = (await addToLibrary(ctx(), igdb, { igdbId: 114283, status: "backlog" })).gameId;
  undertale = (await addToLibrary(ctx(), igdb, { igdbId: 12517, status: "playing" })).gameId;
});

describe("start/stop", () => {
  test("começar cria a sessão ativa e move Próximos para Jogando", () => {
    const result = startTimer(ctx(), { gameId: persona });

    expect(result).toMatchObject({
      alreadyRunning: false,
      stopped: null,
      statusChangedTo: "playing",
    });
    expect(result.active).toMatchObject({
      gameName: "Persona 5 Royal",
      playedOn: "2026-11-19",
      startedAt: "2026-11-19T18:00:00.000Z",
    });
    expect(getLibraryItem(ctx(), persona)).toMatchObject({
      status: "playing",
      startedAt: "2026-11-19",
    });
  });

  test("parar fecha a sessão; enquanto roda, ela não entra em listas, totais nem estatísticas", () => {
    startTimer(ctx(), { gameId: undertale });
    clock.set(at("2026-11-19T16:30"));

    expect(listSessions(ctx())).toEqual([]);
    expect(getLibraryItem(ctx(), undertale).minutesPlayed).toBe(0);
    expect(getStats(ctx(), { today: "2026-11-19", streakMinMinutes: 30 }).todayMinutes).toBe(0);

    const stopped = stopTimer(ctx(), { note: "rota pacifista" });
    expect(stopped).toMatchObject({
      discarded: false,
      dayTotalMinutes: 90,
      gameTotalMinutes: 90,
      session: {
        minutes: 90,
        playedOn: "2026-11-19",
        source: "timer",
        note: "rota pacifista",
        startedAt: "2026-11-19T18:00:00.000Z",
        endedAt: "2026-11-19T19:30:00.000Z",
      },
    });
    expect(getActiveSession(ctx())).toBeNull();
    expect(getLibraryItem(ctx(), undertale).minutesPlayed).toBe(90);
  });

  test("menos de 1 minuto é descartado (clique sem querer)", () => {
    startTimer(ctx(), { gameId: undertale });
    clock.set(new Date(clock.now().getTime() + 50_000));

    expect(stopTimer(ctx(), {})).toEqual({ discarded: true, gameName: "Undertale" });
    expect(getActiveSession(ctx())).toBeNull();
    expect(listSessions(ctx())).toEqual([]);
  });

  test("virada da meia-noite: conta no dia em que começou", () => {
    clock.set(at("2026-11-18T23:30"));
    startTimer(ctx(), { gameId: undertale });
    clock.set(at("2026-11-19T00:45"));

    const stopped = stopTimer(ctx(), {});
    expect(stopped).toMatchObject({ session: { playedOn: "2026-11-18", minutes: 75 } });
  });

  test("esqueceu ligado: informa o horário em que parou (pode ser no dia seguinte)", () => {
    clock.set(at("2026-11-18T20:00"));
    startTimer(ctx(), { gameId: undertale });
    clock.set(at("2026-11-19T15:00")); // 19h depois

    expect(stopTimer(ctx(), { endTime: "22:30" })).toMatchObject({ session: { minutes: 150 } });

    startTimer(ctx(), { gameId: undertale }); // 15:00 do dia 19
    clock.set(at("2026-11-19T16:00"));
    // 01:10 vem depois do início, então é na madrugada do dia 20: no futuro.
    expect(() => stopTimer(ctx(), { endTime: "01:10" })).toThrow(ValidationError);
  });

  test("mais de 24h sem informar o fim é recusado", () => {
    clock.set(at("2026-11-17T10:00"));
    startTimer(ctx(), { gameId: undertale });
    clock.set(at("2026-11-19T10:00"));

    expect(() => stopTimer(ctx(), {})).toThrow("ajuste o horário de fim");
    expect(getActiveSession(ctx())).not.toBeNull();
  });

  test("o dia continua limitado a 24h somando registros manuais", () => {
    logSession(ctx(), { gameId: persona, minutes: 1400, playedOn: "2026-11-18" });
    clock.set(at("2026-11-18T20:00"));
    startTimer(ctx(), { gameId: undertale });
    clock.set(at("2026-11-18T21:00"));

    expect(() => stopTimer(ctx(), {})).toThrow("mais que 24h no dia");
  });
});

describe("um timer por vez", () => {
  test("mesmo jogo: nada muda", () => {
    const first = startTimer(ctx(), { gameId: undertale });
    clock.set(at("2026-11-19T15:10"));
    const again = startTimer(ctx(), { gameId: undertale });

    expect(again).toMatchObject({ alreadyRunning: true, active: { id: first.active.id } });
  });

  test("outro jogo: pede confirmação, e com replaceActive encerra o atual e começa o novo", () => {
    startTimer(ctx(), { gameId: undertale });
    clock.set(at("2026-11-19T16:00"));

    expect(() => startTimer(ctx(), { gameId: persona })).toThrow(TimerActiveError);
    expect(() => startTimer(ctx(), { gameId: persona })).toThrow("Undertale desde 15:00");

    const switched = startTimer(ctx(), { gameId: persona, replaceActive: true });
    expect(switched.stopped).toMatchObject({ discarded: false, session: { minutes: 60 } });
    expect(switched.active).toMatchObject({ gameName: "Persona 5 Royal" });
  });

  test("cancelar descarta sem registrar; sem timer → 404", () => {
    startTimer(ctx(), { gameId: undertale });
    expect(cancelTimer(ctx()).gameName).toBe("Undertale");
    expect(listSessions(ctx())).toEqual([]);
    expect(() => cancelTimer(ctx())).toThrow(NotFoundError);
    expect(() => stopTimer(ctx(), {})).toThrow(NotFoundError);
  });
});

/** Sessão de timer de 1h, ontem das 20:00 às 21:00. */
function timerSession() {
  clock.set(at("2026-11-18T20:00"));
  startTimer(ctx(), { gameId: undertale });
  clock.set(at("2026-11-18T21:00"));
  const stopped = stopTimer(ctx(), {});
  if (stopped.discarded) throw new Error("descartada");
  clock.set(at("2026-11-19T15:00"));
  return stopped.session.id;
}

describe("editar sessão de timer", () => {
  test("corrigir início e fim recalcula a duração", () => {
    const id = timerSession();

    expect(updateSession(ctx(), id, { startTime: "19:30", endTime: "00:15" })).toMatchObject({
      playedOn: "2026-11-18",
      minutes: 285,
      startedAt: "2026-11-18T22:30:00.000Z",
      endedAt: "2026-11-19T03:15:00.000Z",
    });
  });

  test("mudar só a duração move o fim; mudar o dia mantém horário e duração", () => {
    const id = timerSession();

    expect(updateSession(ctx(), id, { minutes: 90 })).toMatchObject({
      endedAt: "2026-11-19T00:30:00.000Z", // 21:30 local
    });
    expect(updateSession(ctx(), id, { playedOn: "2026-11-17" })).toMatchObject({
      playedOn: "2026-11-17",
      minutes: 90,
      startedAt: "2026-11-17T23:00:00.000Z",
    });
  });

  test("sessão manual não aceita horários", () => {
    const { session } = logSession(ctx(), { gameId: undertale, minutes: 30 });
    expect(() => updateSession(ctx(), session.id, { startTime: "10:00" })).toThrow(ValidationError);
  });
});

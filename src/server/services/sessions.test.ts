import { beforeEach, describe, expect, test } from "bun:test";
import { addDays } from "../../shared/dates";
import { activityLog } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { createFakeIgdb, createTestContext, fakeIgdbGame, TEST_TODAY } from "../testing";
import type { ServiceContext } from "./context";
import { addToLibrary, getLibraryItem, updateLibraryEntry } from "./library";
import { deleteSession, listSessions, logSession, updateSession } from "./sessions";

const igdb = createFakeIgdb([
  fakeIgdbGame(),
  fakeIgdbGame({ igdbId: 12517, name: "Undertale", timeToBeat: null }),
]);

let ctx: ServiceContext;
let persona: number;
let undertale: number;

beforeEach(async () => {
  ctx = createTestContext();
  persona = (await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" })).gameId;
  undertale = (await addToLibrary(ctx, igdb, { igdbId: 12517, status: "finished" })).gameId;
});

describe("logSession", () => {
  test("registra hoje por padrão e devolve os totais", () => {
    logSession(ctx, { gameId: persona, minutes: 60 });
    const result = logSession(ctx, { gameId: undertale, minutes: 30, note: "rota pacifista" });

    expect(result.session).toMatchObject({
      gameName: "Undertale",
      playedOn: TEST_TODAY,
      minutes: 30,
      note: "rota pacifista",
      source: "manual",
    });
    expect(result.dayTotalMinutes).toBe(90);
    expect(result.gameTotalMinutes).toBe(30);
    expect(result.statusChangedTo).toBeNull(); // zerado continua zerado (replay)
  });

  test("devolve a ofensiva antes e depois (só conta quando o dia atinge o mínimo)", () => {
    for (let i = 6; i >= 1; i--) {
      logSession(ctx, { gameId: persona, minutes: 30, playedOn: addDays(TEST_TODAY, -i) });
    }

    const short = logSession(ctx, { gameId: persona, minutes: 20 });
    expect(short.streak).toEqual({ before: 6, current: 6 }); // 20min < mínimo de 30

    const enough = logSession(ctx, { gameId: persona, minutes: 10 });
    expect(enough.streak).toEqual({ before: 6, current: 7 });

    const extra = logSession(ctx, { gameId: persona, minutes: 30 });
    expect(extra.streak).toEqual({ before: 7, current: 7 });
  });

  test("a fonte segue o actor (mcp) e pode ser forçada (jobs)", () => {
    const viaMcp = logSession({ ...ctx, actor: "mcp" }, { gameId: persona, minutes: 10 });
    const viaJob = logSession(
      { ...ctx, actor: "job" },
      { gameId: persona, minutes: 10 },
      { source: "timer" },
    );

    expect(viaMcp.session.source).toBe("mcp");
    expect(viaJob.session.source).toBe("timer");
  });

  test("jogo em Próximos passa para Jogando, com início na data da sessão", async () => {
    const zelda = await addToLibrary(
      ctx,
      createFakeIgdb([fakeIgdbGame({ igdbId: 1029, name: "Ocarina of Time" })]),
      { igdbId: 1029, status: "backlog" },
    );

    const result = logSession(ctx, { gameId: zelda.gameId, minutes: 45, playedOn: "2026-11-17" });

    expect(result.statusChangedTo).toBe("playing");
    expect(getLibraryItem(ctx, zelda.gameId)).toMatchObject({
      status: "playing",
      startedAt: "2026-11-17",
    });
  });

  test('sessão anterior ao início puxa o "começou em" para o dia dela', () => {
    // Adicionado como Jogando: começa hoje.
    expect(getLibraryItem(ctx, persona).startedAt).toBe(TEST_TODAY);

    logSession(ctx, { gameId: persona, minutes: 60, playedOn: addDays(TEST_TODAY, -1) });
    logSession(ctx, { gameId: persona, minutes: 60, playedOn: addDays(TEST_TODAY, -7) });
    logSession(ctx, { gameId: persona, minutes: 60, playedOn: addDays(TEST_TODAY, -3) });

    expect(getLibraryItem(ctx, persona).startedAt).toBe(addDays(TEST_TODAY, -7));
  });

  test("zerado: sessão antes do término preenche o início; replay depois não mexe", () => {
    updateLibraryEntry(ctx, undertale, { finishedAt: addDays(TEST_TODAY, -10) });

    logSession(ctx, { gameId: undertale, minutes: 30 }); // replay hoje
    expect(getLibraryItem(ctx, undertale).startedAt).toBeNull();

    logSession(ctx, { gameId: undertale, minutes: 30, playedOn: addDays(TEST_TODAY, -12) });
    expect(getLibraryItem(ctx, undertale)).toMatchObject({
      status: "finished",
      startedAt: addDays(TEST_TODAY, -12),
      finishedAt: addDays(TEST_TODAY, -10),
    });
  });

  test("grava atividade", () => {
    logSession(ctx, { gameId: persona, minutes: 20 });
    expect(ctx.db.select().from(activityLog).all().at(-1)).toMatchObject({
      action: "session.log",
      actor: "web",
    });
  });

  test("rejeita data futura, jogo fora da biblioteca e mais de 24h no dia", () => {
    expect(() => logSession(ctx, { gameId: persona, minutes: 10, playedOn: "2026-11-20" })).toThrow(
      ValidationError,
    );
    expect(() => logSession(ctx, { gameId: 999, minutes: 10 })).toThrow(NotFoundError);

    logSession(ctx, { gameId: persona, minutes: 1000 });
    expect(() => logSession(ctx, { gameId: undertale, minutes: 441 })).toThrow("mais que 24h");
    // Outro dia não conta.
    expect(() =>
      logSession(ctx, { gameId: undertale, minutes: 441, playedOn: "2026-11-18" }),
    ).not.toThrow();
  });
});

describe("logSession com clientId (fila offline)", () => {
  const clientId = "0b9d3c1e-6f2a-4c8e-9a51-3d2f7e8b6a10";

  test("reenviar o mesmo clientId devolve a sessão que já chegou, sem duplicar", () => {
    const first = logSession(ctx, { gameId: persona, minutes: 45, clientId });
    const again = logSession(ctx, { gameId: persona, minutes: 45, clientId });

    expect(first.alreadySaved).toBeUndefined();
    expect(again.alreadySaved).toBe(true);
    expect(again.session.id).toBe(first.session.id);
    expect(again.dayTotalMinutes).toBe(45);
    expect(again.streak.before).toBe(again.streak.current);
    expect(listSessions(ctx)).toHaveLength(1);
    expect(
      ctx.db
        .select()
        .from(activityLog)
        .all()
        .filter((a) => a.action === "session.log"),
    ).toHaveLength(1);
  });

  test("o mesmo clientId de outro usuário é outra sessão", async () => {
    const friend = createTestContext({ db: ctx.db, userId: "amigo" });
    const friendPersona = (await addToLibrary(friend, igdb, { igdbId: 114283, status: "playing" }))
      .gameId;

    logSession(ctx, { gameId: persona, minutes: 45, clientId });
    const theirs = logSession(friend, { gameId: friendPersona, minutes: 20, clientId });

    expect(theirs.alreadySaved).toBeUndefined();
    expect(listSessions(friend)).toHaveLength(1);
    expect(listSessions(ctx)).toHaveLength(1);
  });

  test("sem clientId, cada registro é uma sessão nova", () => {
    logSession(ctx, { gameId: persona, minutes: 10 });
    logSession(ctx, { gameId: persona, minutes: 10 });
    expect(listSessions(ctx)).toHaveLength(2);
  });
});

describe("listSessions", () => {
  test("filtra por jogo e período, mais recentes primeiro", () => {
    logSession(ctx, { gameId: persona, minutes: 10, playedOn: "2026-11-10" });
    logSession(ctx, { gameId: persona, minutes: 20, playedOn: "2026-11-15" });
    logSession(ctx, { gameId: undertale, minutes: 30, playedOn: "2026-11-16" });
    logSession(ctx, { gameId: persona, minutes: 40, playedOn: "2026-11-19" });

    expect(listSessions(ctx, { gameId: persona }).map((s) => s.minutes)).toEqual([40, 20, 10]);
    expect(
      listSessions(ctx, { from: "2026-11-15", to: "2026-11-16" }).map((s) => s.minutes),
    ).toEqual([30, 20]);
    expect(listSessions(ctx, { limit: 1 })).toHaveLength(1);
  });
});

describe("updateSession / deleteSession", () => {
  test("edita minutos, data e nota", () => {
    const { session } = logSession(ctx, { gameId: persona, minutes: 30, note: "x" });

    const updated = updateSession(ctx, session.id, {
      minutes: 90,
      playedOn: "2026-11-18",
      note: "",
    });

    expect(updated).toMatchObject({ minutes: 90, playedOn: "2026-11-18", note: null });
  });

  test('mudar a sessão para antes do início puxa o "começou em"', () => {
    const { session } = logSession(ctx, { gameId: persona, minutes: 60 });
    updateSession(ctx, session.id, { playedOn: addDays(TEST_TODAY, -5) });
    expect(getLibraryItem(ctx, persona).startedAt).toBe(addDays(TEST_TODAY, -5));
  });

  test("o limite diário ignora a própria sessão ao editar", () => {
    const { session } = logSession(ctx, { gameId: persona, minutes: 1400 });

    expect(() => updateSession(ctx, session.id, { minutes: 1440 })).not.toThrow();
    expect(() => updateSession(ctx, session.id, { playedOn: "2026-12-01" })).toThrow(
      ValidationError,
    );
  });

  test("apaga e devolve a sessão apagada", () => {
    const { session } = logSession(ctx, { gameId: persona, minutes: 30 });

    expect(deleteSession(ctx, session.id).id).toBe(session.id);
    expect(listSessions(ctx)).toHaveLength(0);
    expect(() => deleteSession(ctx, session.id)).toThrow(NotFoundError);
  });
});

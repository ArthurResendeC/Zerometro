import { beforeEach, describe, expect, test } from "bun:test";
import { activityLog } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { createFakeIgdb, createTestContext, fakeIgdbGame, TEST_TODAY } from "../testing";
import type { ServiceContext } from "./context";
import { addToLibrary, getLibraryItem } from "./library";
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
    expect(getLibraryItem(ctx.db, zelda.gameId)).toMatchObject({
      status: "playing",
      startedAt: "2026-11-17",
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

describe("listSessions", () => {
  test("filtra por jogo e período, mais recentes primeiro", () => {
    logSession(ctx, { gameId: persona, minutes: 10, playedOn: "2026-11-10" });
    logSession(ctx, { gameId: persona, minutes: 20, playedOn: "2026-11-15" });
    logSession(ctx, { gameId: undertale, minutes: 30, playedOn: "2026-11-16" });
    logSession(ctx, { gameId: persona, minutes: 40, playedOn: "2026-11-19" });

    expect(listSessions(ctx.db, { gameId: persona }).map((s) => s.minutes)).toEqual([40, 20, 10]);
    expect(
      listSessions(ctx.db, { from: "2026-11-15", to: "2026-11-16" }).map((s) => s.minutes),
    ).toEqual([30, 20]);
    expect(listSessions(ctx.db, { limit: 1 })).toHaveLength(1);
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
    expect(listSessions(ctx.db)).toHaveLength(0);
    expect(() => deleteSession(ctx, session.id)).toThrow(NotFoundError);
  });
});

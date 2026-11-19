import { beforeEach, describe, expect, test } from "bun:test";
import { activityLog, games, playSessions } from "../db/schema";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { createFakeIgdb, createTestContext, fakeIgdbGame, TEST_TODAY } from "../testing";
import type { ServiceContext } from "./context";
import {
  addToLibrary,
  applyStatusRules,
  countByStatus,
  getLibraryItem,
  listLibrary,
  previewRemoval,
  removeFromLibrary,
  updateLibraryEntry,
} from "./library";

const igdb = createFakeIgdb([
  fakeIgdbGame(),
  fakeIgdbGame({ igdbId: 12517, name: "Undertale", timeToBeat: null }),
  fakeIgdbGame({ igdbId: 1029, name: "The Legend of Zelda: Ocarina of Time" }),
  fakeIgdbGame({ igdbId: 9999, name: "100%_Orange" }),
]);

let ctx: ServiceContext;

beforeEach(() => {
  ctx = createTestContext();
});

function addSession(gameId: number, playedOn: string, minutes: number) {
  ctx.db.insert(playSessions).values({ gameId, playedOn, minutes }).run();
}

describe("addToLibrary", () => {
  test("adiciona o jogo e registra a atividade", async () => {
    const item = await addToLibrary(ctx, igdb, { igdbId: 114283, status: "backlog" });

    expect(item).toMatchObject({
      name: "Persona 5 Royal",
      status: "backlog",
      startedAt: null,
      finishedAt: null,
      minutesPlayed: 0,
      progress: 0,
      timeToBeat: { mainSec: 315_000, extraSec: 424_580, completeSec: 799_200 },
    });
    expect(ctx.db.select().from(activityLog).all()).toEqual([
      expect.objectContaining({ actor: "web", action: "library.add" }),
    ]);
  });

  test("jogando começa hoje; zerado termina hoje", async () => {
    const playing = await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" });
    const finished = await addToLibrary(ctx, igdb, { igdbId: 12517, status: "finished" });

    expect(playing.startedAt).toBe(TEST_TODAY);
    expect(finished.finishedAt).toBe(TEST_TODAY);
  });

  test("não duplica: ConflictError com o status atual", async () => {
    await addToLibrary(ctx, igdb, { igdbId: 114283, status: "wishlist" });

    const again = addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" });
    await expect(again).rejects.toBeInstanceOf(ConflictError);
    await expect(again).rejects.toThrow("já está na biblioteca (Desejos)");
  });
});

describe("listLibrary", () => {
  test("filtra por status e por nome (sem diferenciar maiúsculas)", async () => {
    await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" });
    await addToLibrary(ctx, igdb, { igdbId: 12517, status: "backlog" });
    await addToLibrary(ctx, igdb, { igdbId: 1029, status: "backlog" });

    expect(listLibrary(ctx.db, { status: "backlog" }).map((i) => i.name)).toEqual([
      "The Legend of Zelda: Ocarina of Time",
      "Undertale",
    ]);
    expect(listLibrary(ctx.db, { q: "ZELDA" }).map((i) => i.name)).toEqual([
      "The Legend of Zelda: Ocarina of Time",
    ]);
  });

  test("% e _ na busca são literais", async () => {
    await addToLibrary(ctx, igdb, { igdbId: 9999, status: "backlog" });
    await addToLibrary(ctx, igdb, { igdbId: 12517, status: "backlog" });

    expect(listLibrary(ctx.db, { q: "%_" }).map((i) => i.name)).toEqual(["100%_Orange"]);
    expect(listLibrary(ctx.db, { q: "_" }).map((i) => i.name)).toEqual(["100%_Orange"]);
  });

  test("soma o tempo jogado, calcula progresso e ordena por jogado recentemente", async () => {
    const persona = await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" });
    const undertale = await addToLibrary(ctx, igdb, { igdbId: 12517, status: "playing" });
    await addToLibrary(ctx, igdb, { igdbId: 1029, status: "backlog" });
    addSession(persona.gameId, "2026-11-17", 120);
    addSession(persona.gameId, "2026-11-18", 90);
    addSession(undertale.gameId, "2026-11-19", 30);

    const items = listLibrary(ctx.db);

    expect(items.map((i) => i.name)).toEqual([
      "Undertale",
      "Persona 5 Royal",
      "The Legend of Zelda: Ocarina of Time",
    ]);
    expect(items[1]).toMatchObject({
      minutesPlayed: 210,
      sessionsCount: 2,
      lastPlayedOn: "2026-11-18",
      progress: (210 * 60) / 315_000,
    });
    expect(items[0]?.progress).toBeNull(); // Undertale sem tempo para zerar
  });

  test("countByStatus inclui todos os status, mesmo zerados", async () => {
    await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" });
    await addToLibrary(ctx, igdb, { igdbId: 12517, status: "backlog" });
    await addToLibrary(ctx, igdb, { igdbId: 1029, status: "backlog" });

    expect(countByStatus(ctx.db)).toEqual({
      playing: 1,
      finished: 0,
      backlog: 2,
      wishlist: 0,
      paused: 0,
      dropped: 0,
    });
  });
});

describe("updateLibraryEntry", () => {
  test("zerar com nota e depois voltar a jogar limpa a data de término", async () => {
    const { gameId } = await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" });

    const finished = updateLibraryEntry(ctx, gameId, { status: "finished", rating: 9 });
    expect(finished).toMatchObject({ status: "finished", finishedAt: TEST_TODAY, rating: 9 });

    const replaying = updateLibraryEntry(ctx, gameId, { status: "playing" });
    expect(replaying).toMatchObject({ status: "playing", finishedAt: null, rating: 9 });
  });

  test("notas vazias viram null e a atividade guarda o actor", async () => {
    const { gameId } = await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" });

    updateLibraryEntry({ ...ctx, actor: "mcp" }, gameId, { notes: "" });

    expect(getLibraryItem(ctx.db, gameId).notes).toBeNull();
    expect(ctx.db.select().from(activityLog).all().at(-1)).toMatchObject({
      actor: "mcp",
      action: "library.update",
    });
  });

  test("jogo fora da biblioteca → NotFoundError", () => {
    expect(() => updateLibraryEntry(ctx, 42, { status: "playing" })).toThrow(NotFoundError);
  });
});

describe("removeFromLibrary", () => {
  test("apaga jogo e sessões e devolve o resumo", async () => {
    const { gameId } = await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" });
    addSession(gameId, "2026-11-18", 90);
    addSession(gameId, "2026-11-19", 45);

    expect(previewRemoval(ctx.db, gameId)).toEqual({
      gameId,
      name: "Persona 5 Royal",
      sessionsCount: 2,
      minutesPlayed: 135,
    });

    removeFromLibrary(ctx, gameId);

    expect(listLibrary(ctx.db)).toHaveLength(0);
    expect(ctx.db.select().from(games).all()).toHaveLength(0);
    expect(ctx.db.select().from(playSessions).all()).toHaveLength(0);
    expect(ctx.db.select().from(activityLog).all().at(-1)?.action).toBe("library.remove");
  });
});

describe("applyStatusRules", () => {
  const today = "2026-11-19";
  const base = { status: "backlog" as const, startedAt: null, finishedAt: null };

  test("só devolve o que mudou", () => {
    expect(applyStatusRules(base, { status: "wishlist" }, today)).toEqual({});
    expect(applyStatusRules(base, { status: "playing" }, today)).toEqual({ startedAt: today });
  });

  test("respeita datas informadas e mantém o início existente", () => {
    const playing = { status: "playing" as const, startedAt: "2026-10-01", finishedAt: null };

    expect(
      applyStatusRules(playing, { status: "finished", finishedAt: "2026-11-10" }, today),
    ).toEqual({ finishedAt: "2026-11-10" });
  });

  test("rejeita datas no futuro e término antes do início", () => {
    expect(() =>
      applyStatusRules(base, { status: "finished", finishedAt: "2026-11-20" }, today),
    ).toThrow(ValidationError);
    expect(() =>
      applyStatusRules(
        { status: "playing", startedAt: "2026-11-10", finishedAt: null },
        { status: "finished", finishedAt: "2026-11-01" },
        today,
      ),
    ).toThrow("antes da data de início");
  });
});

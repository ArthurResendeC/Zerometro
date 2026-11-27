import { beforeEach, describe, expect, test } from "bun:test";
import { activityLog, completions, games, objectives, playSessions } from "../db/schema";
import { AmbiguousGameError, ConflictError, NotFoundError, ValidationError } from "../errors";
import { createFakeIgdb, createTestContext, fakeIgdbGame, rateGut, TEST_TODAY } from "../testing";
import type { ServiceContext } from "./context";
import {
  resolveLibraryGame,
  addToLibrary,
  applyStatusRules,
  countByStatus,
  getLibraryItem,
  listLibrary,
  previewRemoval,
  removeFromLibrary,
  updateLibraryEntry,
} from "./library";
import { logSession } from "./sessions";
import { getStats } from "./stats";

const igdb = createFakeIgdb([
  fakeIgdbGame(),
  fakeIgdbGame({ igdbId: 12517, name: "Undertale", timeToBeat: null }),
  fakeIgdbGame({ igdbId: 1029, name: "The Legend of Zelda: Ocarina of Time" }),
  fakeIgdbGame({ igdbId: 9999, name: "100%_Orange" }),
  fakeIgdbGame({ igdbId: 2048, name: "2048" }),
  fakeIgdbGame({ igdbId: 7001, name: "Pokémon Red" }),
  fakeIgdbGame({ igdbId: 7002, name: "Pokémon Blue" }),
]);

let ctx: ServiceContext;

beforeEach(() => {
  ctx = createTestContext();
});

function addSession(gameId: number, playedOn: string, minutes: number) {
  ctx.db.insert(playSessions).values({ userId: ctx.userId, gameId, playedOn, minutes }).run();
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

    expect(listLibrary(ctx, { status: "backlog" }).map((i) => i.name)).toEqual([
      "The Legend of Zelda: Ocarina of Time",
      "Undertale",
    ]);
    expect(listLibrary(ctx, { q: "ZELDA" }).map((i) => i.name)).toEqual([
      "The Legend of Zelda: Ocarina of Time",
    ]);
  });

  test("% e _ na busca são literais", async () => {
    await addToLibrary(ctx, igdb, { igdbId: 9999, status: "backlog" });
    await addToLibrary(ctx, igdb, { igdbId: 12517, status: "backlog" });

    expect(listLibrary(ctx, { q: "%_" }).map((i) => i.name)).toEqual(["100%_Orange"]);
    expect(listLibrary(ctx, { q: "_" }).map((i) => i.name)).toEqual(["100%_Orange"]);
  });

  test("soma o tempo jogado, calcula progresso e ordena por jogado recentemente", async () => {
    const persona = await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" });
    const undertale = await addToLibrary(ctx, igdb, { igdbId: 12517, status: "playing" });
    await addToLibrary(ctx, igdb, { igdbId: 1029, status: "backlog" });
    addSession(persona.gameId, "2026-11-17", 120);
    addSession(persona.gameId, "2026-11-18", 90);
    addSession(undertale.gameId, "2026-11-19", 30);

    const items = listLibrary(ctx);

    expect(items.map((i) => i.name)).toEqual([
      "Undertale",
      "Persona 5 Royal",
      "The Legend of Zelda: Ocarina of Time",
    ]);
    expect(items[1]).toMatchObject({
      minutesPlayed: 210,
      sessionsCount: 2,
      lastPlayedOn: "2026-11-18",
      firstPlayedOn: "2026-11-17",
      progress: (210 * 60) / 315_000,
    });
    expect(items[0]?.progress).toBeNull(); // Undertale sem tempo para zerar
  });

  test("sem fim: não tem barra de progresso, mesmo com tempo do IGDB", async () => {
    const { gameId } = await addToLibrary(ctx, igdb, { igdbId: 114283, status: "endless" });
    logSession(ctx, { gameId, minutes: 600, playedOn: "2026-11-18" });
    expect(getLibraryItem(ctx, gameId)).toMatchObject({
      status: "endless",
      displayState: "endless",
      progress: null,
      // Começou hoje, mas a sessão de ontem puxa o início para ela.
      startedAt: "2026-11-18",
    });
  });

  test("meta da barra: escolher, horas, voltar ao padrão e as validações", async () => {
    const { gameId } = await addToLibrary(ctx, igdb, { igdbId: 114283, status: "endless" });
    logSession(ctx, { gameId, minutes: 300, playedOn: "2026-11-18" });
    expect(getLibraryItem(ctx, gameId)).toMatchObject({
      progressGoal: "none",
      progressGoalCustom: false,
    });

    expect(() => updateLibraryEntry(ctx, gameId, { progressGoal: "hours" })).toThrow(/horas/);
    updateLibraryEntry(ctx, gameId, { progressGoal: "hours", progressGoalMinutes: 600 });
    expect(getLibraryItem(ctx, gameId)).toMatchObject({
      progressGoal: "hours",
      progressGoalCustom: true,
      progressTargetMinutes: 600,
      progress: 0.5,
      progressDone: false,
    });
    // Só as horas: a meta continua em horas.
    updateLibraryEntry(ctx, gameId, { progressGoalMinutes: 300 });
    expect(getLibraryItem(ctx, gameId)).toMatchObject({ progress: 1, progressDone: true });

    // Trocar para um nível apaga as horas; horas sem a meta em horas é erro.
    updateLibraryEntry(ctx, gameId, { progressGoal: "extras" });
    expect(getLibraryItem(ctx, gameId)).toMatchObject({
      progressGoal: "extras",
      progressTargetMinutes: Math.round(424580 / 60),
    });
    expect(() => updateLibraryEntry(ctx, gameId, { progressGoalMinutes: 600 })).toThrow(/horas/);

    updateLibraryEntry(ctx, gameId, { progressGoal: null });
    expect(getLibraryItem(ctx, gameId)).toMatchObject({
      progressGoal: "none",
      progressGoalCustom: false,
      progress: null,
    });
  });

  test("countByStatus inclui todos os status, mesmo zerados", async () => {
    await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" });
    await addToLibrary(ctx, igdb, { igdbId: 12517, status: "backlog" });
    await addToLibrary(ctx, igdb, { igdbId: 1029, status: "backlog" });

    expect(countByStatus(ctx)).toEqual({
      playing: 1,
      endless: 0,
      finished: 0,
      backlog: 2,
      wishlist: 0,
      paused: 0,
      dropped: 0,
    });
  });
});

describe("onde parei (lastNote)", () => {
  test("a nota da última sessão com nota; sessão depois sem nota não apaga", async () => {
    const { gameId } = await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" });
    const { gameId: other } = await addToLibrary(ctx, igdb, { igdbId: 12517, status: "playing" });
    const session = (playedOn: string, note: string | null, game = gameId) =>
      ctx.db
        .insert(playSessions)
        .values({ userId: ctx.userId, gameId: game, playedOn, minutes: 30, note })
        .returning({ id: playSessions.id })
        .get().id;

    session("2026-11-10", "começo do Palácio 1");
    const palace3 = session("2026-11-15", "parei no Palácio 3");
    session("2026-11-18", null); // ex.: sessão da Steam
    session("2026-11-18", "   ", other); // só espaços: não conta

    const items = listLibrary(ctx);
    expect(items.find((i) => i.gameId === gameId)?.lastNote).toEqual({
      sessionId: palace3,
      note: "parei no Palácio 3",
      playedOn: "2026-11-15",
    });
    expect(items.find((i) => i.gameId === other)?.lastNote).toBeNull();
    expect(getLibraryItem(ctx, gameId).lastNote?.note).toBe("parei no Palácio 3");
  });
});

describe("updateLibraryEntry", () => {
  test("zerar com nota e depois voltar a jogar limpa a data de término", async () => {
    const { gameId } = await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" });
    rateGut(ctx, gameId, 9);

    const finished = updateLibraryEntry(ctx, gameId, { status: "finished" });
    expect(finished.previousStatus).toBe("playing");
    expect(finished.item).toMatchObject({ status: "finished", finishedAt: TEST_TODAY, rating: 9 });

    const replaying = updateLibraryEntry(ctx, gameId, { status: "playing" });
    expect(replaying.previousStatus).toBe("finished");
    expect(replaying.item).toMatchObject({ status: "playing", finishedAt: null, rating: 9 });
  });

  test("notas vazias viram null e a atividade guarda o actor", async () => {
    const { gameId } = await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" });

    updateLibraryEntry({ ...ctx, actor: "mcp" }, gameId, { notes: "" });

    expect(getLibraryItem(ctx, gameId).notes).toBeNull();
    expect(ctx.db.select().from(activityLog).all().at(-1)).toMatchObject({
      actor: "mcp",
      action: "library.update",
    });
  });

  test("jogo fora da biblioteca → NotFoundError", () => {
    expect(() => updateLibraryEntry(ctx, 42, { status: "playing" })).toThrow(NotFoundError);
  });
});

describe("tempo anterior ao Zerômetro", () => {
  test("soma no total e no progresso do jogo, mas não nas estatísticas", async () => {
    // Persona 5 Royal: 87,5h de história no fake do IGDB.
    const { gameId } = await addToLibrary(ctx, igdb, {
      igdbId: 114283,
      status: "playing",
      priorMinutes: 39 * 60,
    });
    logSession(ctx, { gameId, minutes: 60 });

    const item = getLibraryItem(ctx, gameId);
    expect(item).toMatchObject({ minutesPlayed: 40 * 60, priorMinutes: 39 * 60, sessionsCount: 1 });
    expect(item.progress).toBeCloseTo((40 * 3600) / 315_000);

    const stats = getStats(ctx, { today: TEST_TODAY, streakMinMinutes: 30 });
    expect(stats.totalMinutes).toBe(60);
    expect(stats.todayMinutes).toBe(60);
    expect(stats.topGames[0]?.minutes).toBe(60);
  });

  test("jogo sem sessões já aparece como jogado; editar substitui o valor", async () => {
    const { gameId } = await addToLibrary(ctx, igdb, { igdbId: 1029, status: "paused" });
    expect(getLibraryItem(ctx, gameId).minutesPlayed).toBe(0);

    updateLibraryEntry(ctx, gameId, { priorMinutes: 600 });
    updateLibraryEntry(ctx, gameId, { priorMinutes: 900 });

    expect(getLibraryItem(ctx, gameId)).toMatchObject({
      minutesPlayed: 900,
      priorMinutes: 900,
      sessionsCount: 0,
      lastPlayedOn: null,
      firstPlayedOn: null,
      status: "paused",
    });
    expect(ctx.db.select().from(activityLog).all().at(-1)).toMatchObject({
      action: "library.update",
      payload: { changes: { priorMinutes: 900 } },
    });
  });
});

describe("removeFromLibrary", () => {
  test("tira o jogo da biblioteca, apaga sessões, conclusões e objetivos e devolve o resumo", async () => {
    const { gameId } = await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" });
    addSession(gameId, "2026-11-18", 90);
    addSession(gameId, "2026-11-19", 45);
    const { userId } = ctx;
    ctx.db
      .insert(completions)
      .values({ userId, gameId, type: "main", completedOn: "2026-11-19" })
      .run();
    ctx.db.insert(objectives).values({ userId, gameId, title: "Todos os confidants" }).run();

    expect(previewRemoval(ctx, gameId)).toEqual({
      gameId,
      name: "Persona 5 Royal",
      sessionsCount: 2,
      minutesPlayed: 135,
      completionsCount: 1,
      objectivesCount: 1,
      ratingsCount: 0,
      achievementsUnlocked: 0,
    });

    removeFromLibrary(ctx, gameId);

    expect(listLibrary(ctx)).toHaveLength(0);
    // O jogo continua no cache do IGDB (compartilhado entre usuários).
    expect(ctx.db.select().from(games).all()).toHaveLength(1);
    expect(ctx.db.select().from(playSessions).all()).toHaveLength(0);
    expect(ctx.db.select().from(completions).all()).toHaveLength(0);
    expect(ctx.db.select().from(objectives).all()).toHaveLength(0);
    expect(ctx.db.select().from(activityLog).all().at(-1)?.action).toBe("library.remove");
  });
});

describe("applyStatusRules", () => {
  const today = "2026-11-19";
  const base = { status: "backlog" as const, startedAt: null, finishedAt: null };

  test("só devolve o que mudou", () => {
    expect(applyStatusRules(base, { status: "wishlist" }, today)).toEqual({});
    expect(applyStatusRules(base, { status: "playing" }, today)).toEqual({ startedAt: today });
    expect(applyStatusRules(base, { status: "endless" }, today)).toEqual({ startedAt: today });
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

async function add(igdbId: number) {
  return (await addToLibrary(ctx, igdb, { igdbId, status: "backlog" })).gameId;
}

describe("resolveLibraryGame", () => {
  test("por id (número ou texto) e por nome sem diferenciar maiúsculas e acentos", async () => {
    const red = await add(7001);
    expect(resolveLibraryGame(ctx, red).name).toBe("Pokémon Red");
    expect(resolveLibraryGame(ctx, String(red)).name).toBe("Pokémon Red");
    expect(resolveLibraryGame(ctx, "  POKEMON   red ").gameId).toBe(red);
    expect(resolveLibraryGame(ctx, "red").gameId).toBe(red);
  });

  test("nome exato ganha de quem só contém o termo", async () => {
    await add(114283); // Persona 5 Royal
    const zelda = await add(1029);
    expect(resolveLibraryGame(ctx, "the legend of zelda: ocarina of time").gameId).toBe(zelda);
  });

  test("vários candidatos → AmbiguousGameError com as opções", async () => {
    await add(7001);
    await add(7002);
    try {
      resolveLibraryGame(ctx, "pokemon");
      throw new Error("deveria ter falhado");
    } catch (error) {
      expect(error).toBeInstanceOf(AmbiguousGameError);
      expect((error as AmbiguousGameError).options.map((o) => o.name).toSorted()).toEqual([
        "Pokémon Blue",
        "Pokémon Red",
      ]);
    }
  });

  test("nome só com dígitos que não é id cai na busca por nome", async () => {
    const game = await add(2048);
    expect(game).not.toBe(2048);
    expect(resolveLibraryGame(ctx, "2048").gameId).toBe(game);
  });

  test("sem candidato → NotFoundError; vazio → ValidationError", async () => {
    await add(7001);
    expect(() => resolveLibraryGame(ctx, "zelda")).toThrow(NotFoundError);
    expect(() => resolveLibraryGame(ctx, 42)).toThrow(NotFoundError);
    expect(() => resolveLibraryGame(ctx, "   ")).toThrow(ValidationError);
  });
});

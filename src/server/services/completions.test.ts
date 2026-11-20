import { beforeEach, describe, expect, test } from "bun:test";
import { activityLog, completions } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { createFakeIgdb, createTestContext, fakeIgdbGame, TEST_TODAY } from "../testing";
import { listCompletions, markCompleted, removeCompletion } from "./completions";
import type { ServiceContext } from "./context";
import {
  addToLibrary,
  countPostgame,
  getLibraryItem,
  listLibrary,
  updateLibraryEntry,
} from "./library";

const igdb = createFakeIgdb([
  fakeIgdbGame(),
  fakeIgdbGame({ igdbId: 12517, name: "Undertale", timeToBeat: null }),
]);

let ctx: ServiceContext;

beforeEach(() => {
  ctx = createTestContext();
});

async function add(status: "playing" | "finished" | "backlog" = "playing", igdbId = 114283) {
  return (await addToLibrary(ctx, igdb, { igdbId, status })).gameId;
}

const completionRows = () =>
  ctx.db
    .select({ type: completions.type, completedOn: completions.completedOn })
    .from(completions)
    .all();

describe("markCompleted", () => {
  test("data padrão é hoje e o status não muda (jogando vira pós-jogo)", async () => {
    const gameId = await add();

    const { completion, item, previousStatus } = markCompleted(ctx, gameId, { type: "main" });

    expect(completion).toMatchObject({ gameId, type: "main", completedOn: TEST_TODAY, note: null });
    expect(previousStatus).toBe("playing");
    expect(item).toMatchObject({
      status: "playing",
      displayState: "postgame",
      completion: {
        best: "main",
        count: 1,
        firstCompletedOn: TEST_TODAY,
        lastCompletedOn: TEST_TODAY,
      },
      progressTarget: "extras",
    });
    expect(ctx.db.select().from(activityLog).all().at(-1)).toMatchObject({
      action: "completion.add",
      payload: { gameId, type: "main", completedOn: TEST_TODAY },
    });
  });

  test("data no futuro é rejeitada", async () => {
    const gameId = await add();
    expect(() => markCompleted(ctx, gameId, { type: "main", date: "2026-11-20" })).toThrow(
      ValidationError,
    );
    expect(completionRows()).toHaveLength(0);
  });

  test("replay e 100% viram novas linhas; o resumo pega o melhor e as datas extremas", async () => {
    const gameId = await add();
    markCompleted(ctx, gameId, { type: "main", date: "2025-03-01" });
    markCompleted(ctx, gameId, { type: "full", date: "2025-06-10", note: "Platina" });
    const { item } = markCompleted(ctx, gameId, { type: "main", date: "2026-11-01" });

    expect(item.completion).toEqual({
      best: "full",
      count: 3,
      firstCompletedOn: "2025-03-01",
      lastCompletedOn: "2026-11-01",
    });
    expect(item.progress).toBe(1);
    expect(listCompletions(ctx, gameId).map((c) => c.completedOn)).toEqual([
      "2026-11-01",
      "2025-06-10",
      "2025-03-01",
    ]);
  });

  test("moveToFinished move para Zerados na data da conclusão", async () => {
    const gameId = await add();

    const { item } = markCompleted(ctx, gameId, {
      type: "extras",
      date: "2026-11-18",
      moveToFinished: true,
    });

    expect(item).toMatchObject({
      status: "finished",
      displayState: "finished",
      // Adicionado hoje como jogando: o início recua para o dia em que zerou.
      startedAt: "2026-11-18",
      finishedAt: "2026-11-18",
    });
    expect(completionRows()).toEqual([{ type: "extras", completedOn: "2026-11-18" }]);
  });

  test("jogo fora da biblioteca → 404", () => {
    expect(() => markCompleted(ctx, 999, { type: "main" })).toThrow(NotFoundError);
  });
});

describe("status zerado e conclusões", () => {
  test("virar zerado sem conclusão cria a da história, uma vez só", async () => {
    const gameId = await add("backlog");

    updateLibraryEntry(ctx, gameId, { status: "finished", finishedAt: "2026-11-10" });
    updateLibraryEntry(ctx, gameId, { status: "playing" });
    updateLibraryEntry(ctx, gameId, { status: "finished" });

    expect(completionRows()).toEqual([{ type: "main", completedOn: "2026-11-10" }]);
  });

  test("com conclusão, virar zerado não duplica; sair de zerado não apaga", async () => {
    const gameId = await add();
    markCompleted(ctx, gameId, { type: "full", date: "2026-10-01" });

    updateLibraryEntry(ctx, gameId, { status: "finished" });
    const { item } = updateLibraryEntry(ctx, gameId, { status: "paused" });

    expect(completionRows()).toEqual([{ type: "full", completedOn: "2026-10-01" }]);
    expect(item.completion?.best).toBe("full");
  });

  test("adicionar já como zerado cria a conclusão de hoje", async () => {
    await add("finished");
    expect(completionRows()).toEqual([{ type: "main", completedOn: TEST_TODAY }]);
  });
});

describe("pós-jogo na biblioteca", () => {
  test("filtro e contagem só com jogos jogando que já têm conclusão", async () => {
    const persona = await add();
    const undertale = await add("finished", 12517);
    markCompleted(ctx, persona, { type: "main" });

    expect(listLibrary(ctx, { displayState: "postgame" }).map((i) => i.gameId)).toEqual([persona]);
    expect(countPostgame(ctx)).toBe(1);
    expect(getLibraryItem(ctx, undertale).displayState).toBe("finished");
  });
});

describe("removeCompletion", () => {
  test("apaga a conclusão e devolve o item atualizado, sem mexer no status", async () => {
    const gameId = await add();
    const { completion } = markCompleted(ctx, gameId, { type: "main" });

    const { removed, item } = removeCompletion(ctx, completion.id);

    expect(removed.id).toBe(completion.id);
    expect(item).toMatchObject({ status: "playing", displayState: "playing", completion: null });
    expect(ctx.db.select().from(activityLog).all().at(-1)?.action).toBe("completion.remove");
  });

  test("conclusão de outro usuário → 404", async () => {
    const gameId = await add();
    const { completion } = markCompleted(ctx, gameId, { type: "main" });
    const other = createTestContext({ db: ctx.db, userId: "user-2" });

    expect(() => removeCompletion(other, completion.id)).toThrow(NotFoundError);
    expect(() => listCompletions(other, gameId)).toThrow(NotFoundError);
  });
});

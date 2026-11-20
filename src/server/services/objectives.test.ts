import { beforeEach, describe, expect, test } from "bun:test";
import { activityLog, objectives } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { createFakeIgdb, createTestContext, fakeIgdbGame, TEST_NOW } from "../testing";
import { markCompleted } from "./completions";
import type { ServiceContext } from "./context";
import { addToLibrary, getLibraryItem } from "./library";
import {
  addObjective,
  deleteObjective,
  incrementObjective,
  listObjectives,
  reorderObjectives,
  setObjectiveDone,
  updateObjective,
} from "./objectives";

const igdb = createFakeIgdb([fakeIgdbGame()]);

let ctx: ServiceContext;
let gameId: number;

beforeEach(async () => {
  ctx = createTestContext();
  gameId = (await addToLibrary(ctx, igdb, { igdbId: 114283, status: "playing" })).gameId;
});

const add = (title: string, target?: number) => addObjective(ctx, gameId, { title, target });

describe("addObjective", () => {
  test("checkbox por padrão, contador com alvo; entra no fim da lista", () => {
    const { objective, summary } = add("Todos os confidants");
    add("Sementes Korok", 900);

    expect(objective).toMatchObject({
      source: "manual",
      target: 1,
      progress: 0,
      unlockedAt: null,
      sortOrder: 0,
    });
    expect(summary).toEqual({ total: 1, unlocked: 0 });
    expect(listObjectives(ctx, gameId).map((o) => [o.title, o.sortOrder])).toEqual([
      ["Todos os confidants", 0],
      ["Sementes Korok", 1],
    ]);
    expect(getLibraryItem(ctx, gameId).objectives).toEqual({ total: 2, unlocked: 0 });
    expect(ctx.db.select().from(activityLog).all().at(-1)?.action).toBe("objective.add");
  });

  test("jogo fora da biblioteca → 404", () => {
    expect(() => addObjective(ctx, 999, { title: "X" })).toThrow(NotFoundError);
  });
});

describe("progresso", () => {
  test("incremento fica entre 0 e o alvo; unlocked_at preenche no alvo e limpa ao sair", () => {
    const { objective } = add("Sementes Korok", 900);

    expect(incrementObjective(ctx, objective.id, 10).objective.progress).toBe(10);
    expect(incrementObjective(ctx, objective.id, -50).objective.progress).toBe(0);

    const done = incrementObjective(ctx, objective.id, 5000).objective;
    expect(done).toMatchObject({ progress: 900, unlockedAt: TEST_NOW.toISOString() });

    const undone = incrementObjective(ctx, objective.id, -1).objective;
    expect(undone).toMatchObject({ progress: 899, unlockedAt: null });
  });

  test("baixar o alvo ajusta o progresso; progresso informado é limitado", () => {
    const { objective } = add("Morangos", 175);
    incrementObjective(ctx, objective.id, 150);

    expect(updateObjective(ctx, objective.id, { target: 100 }).objective).toMatchObject({
      target: 100,
      progress: 100,
    });
    expect(updateObjective(ctx, objective.id, { progress: -3 }).objective.progress).toBe(0);
    expect(updateObjective(ctx, objective.id, { progress: 500 }).objective.progress).toBe(100);
  });

  test("feito/desfeito; título e descrição", () => {
    const { objective } = add("Chefe secreto");

    expect(setObjectiveDone(ctx, objective.id, true).objective.progress).toBe(1);
    expect(setObjectiveDone(ctx, objective.id, false).objective.progress).toBe(0);
    expect(
      updateObjective(ctx, objective.id, { title: "Chefe opcional", description: "" }).objective,
    ).toMatchObject({ title: "Chefe opcional", description: null });
  });
});

describe("todos concluídos", () => {
  test("sugere o 100% só na mudança que conclui o último, e só sem conclusão 100%", () => {
    const a = add("A").objective;
    const b = add("B", 3).objective;

    expect(setObjectiveDone(ctx, a.id, true)).toMatchObject({
      allDoneNow: false,
      suggestFullCompletion: false,
    });
    expect(incrementObjective(ctx, b.id, 3)).toMatchObject({
      summary: { total: 2, unlocked: 2 },
      allDoneNow: true,
      suggestFullCompletion: true,
    });
    // Já estava tudo feito: editar não sugere de novo.
    expect(updateObjective(ctx, b.id, { title: "B!" })).toMatchObject({
      allDoneNow: false,
      suggestFullCompletion: false,
    });

    markCompleted(ctx, gameId, { type: "full" });
    incrementObjective(ctx, b.id, -1);
    expect(incrementObjective(ctx, b.id, 1)).toMatchObject({
      allDoneNow: true,
      suggestFullCompletion: false,
    });
  });
});

describe("deleteObjective e reorderObjectives", () => {
  test("apaga e devolve o resumo", () => {
    const { objective } = add("A");
    add("B");

    expect(deleteObjective(ctx, objective.id)).toMatchObject({
      deleted: { title: "A" },
      summary: { total: 1, unlocked: 0 },
    });
  });

  test("reordena com todos os ids do jogo; faltando ou sobrando → erro", () => {
    const a = add("A").objective;
    const b = add("B").objective;
    const c = add("C").objective;

    expect(reorderObjectives(ctx, gameId, [c.id, a.id, b.id]).map((o) => o.title)).toEqual([
      "C",
      "A",
      "B",
    ]);
    expect(() => reorderObjectives(ctx, gameId, [a.id, b.id])).toThrow(ValidationError);
    expect(() => reorderObjectives(ctx, gameId, [a.id, a.id, b.id])).toThrow(ValidationError);
    expect(() => reorderObjectives(ctx, gameId, [a.id, b.id, 999])).toThrow(ValidationError);
  });
});

describe("isolamento e fontes externas", () => {
  test("objetivo de outro usuário → 404", () => {
    const { objective } = add("A");
    const other = createTestContext({ db: ctx.db, userId: "user-2" });

    expect(() => incrementObjective(other, objective.id, 1)).toThrow(NotFoundError);
    expect(() => deleteObjective(other, objective.id)).toThrow(NotFoundError);
  });

  test("conquista sincronizada não é editável", () => {
    const { id } = ctx.db
      .insert(objectives)
      .values({ userId: ctx.userId, gameId, source: "steam", externalId: "ACH", title: "X" })
      .returning({ id: objectives.id })
      .get();

    expect(() => setObjectiveDone(ctx, id, true)).toThrow(ValidationError);
    expect(() => deleteObjective(ctx, id)).toThrow(ValidationError);
  });
});

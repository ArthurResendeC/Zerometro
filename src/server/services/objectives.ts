import { and, asc, eq, sql } from "drizzle-orm";
import {
  type AddObjectiveInput,
  MAX_OBJECTIVES_PER_GAME,
  type ObjectiveItem,
  type ObjectivesSummary,
  type ObjectiveWriteResult,
  type UpdateObjectiveInput,
} from "../../shared/objectives";
import type { DbOrTx } from "../db/client";
import { objectives } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { logActivity } from "./activity";
import type { ServiceContext, UserScope } from "./context";
import { getLibraryItem } from "./library";

// Objetivos de um jogo: checkbox (alvo 1) ou contador. Concluir todos sugere marcar o 100%,
// mas nunca cria a conclusão sozinho.

const columns = {
  id: objectives.id,
  gameId: objectives.gameId,
  source: objectives.source,
  title: objectives.title,
  description: objectives.description,
  iconUrl: objectives.iconUrl,
  rarity: objectives.rarity,
  target: objectives.target,
  progress: objectives.progress,
  unlockedAt: objectives.unlockedAt,
  sortOrder: objectives.sortOrder,
  createdAt: objectives.createdAt,
  updatedAt: objectives.updatedAt,
};

const ofGame = (userId: string, gameId: number) =>
  and(eq(objectives.userId, userId), eq(objectives.gameId, gameId));

/** Objetivos do jogo, na ordem escolhida pelo usuário. */
export function listObjectives(scope: UserScope, gameId: number): ObjectiveItem[] {
  getLibraryItem(scope, gameId); // 404 se o jogo não estiver na biblioteca
  return scope.db
    .select(columns)
    .from(objectives)
    .where(ofGame(scope.userId, gameId))
    .orderBy(asc(objectives.sortOrder), asc(objectives.id))
    .all();
}

export function getObjective({ db, userId }: UserScope, id: number): ObjectiveItem {
  const objective = db
    .select(columns)
    .from(objectives)
    .where(and(eq(objectives.id, id), eq(objectives.userId, userId)))
    .get();
  if (!objective) throw new NotFoundError(`Objetivo ${id} não encontrado`);
  return objective;
}

function summarize({ db, userId }: { db: DbOrTx; userId: string }, gameId: number) {
  const row = db
    .select({
      total: sql<number>`count(*)`,
      unlocked: sql<number>`coalesce(sum(${objectives.progress} >= ${objectives.target}), 0)`,
    })
    .from(objectives)
    .where(ofGame(userId, gameId))
    .get();
  return { total: row?.total ?? 0, unlocked: row?.unlocked ?? 0 } satisfies ObjectivesSummary;
}

const allDone = (s: ObjectivesSummary) => s.total > 0 && s.unlocked === s.total;

export function addObjective(
  ctx: ServiceContext,
  gameId: number,
  input: AddObjectiveInput,
): ObjectiveWriteResult {
  const item = getLibraryItem(ctx, gameId);
  const before = summarize(ctx, gameId);
  if (before.total >= MAX_OBJECTIVES_PER_GAME) {
    throw new ValidationError(`Um jogo tem no máximo ${MAX_OBJECTIVES_PER_GAME} objetivos`);
  }

  const objective = ctx.db.transaction((tx) => {
    const { next } = tx
      .select({ next: sql<number>`coalesce(max(${objectives.sortOrder}) + 1, 0)` })
      .from(objectives)
      .where(ofGame(ctx.userId, gameId))
      .get()!;
    const row = tx
      .insert(objectives)
      .values({
        userId: ctx.userId,
        gameId,
        title: input.title,
        description: input.description || null,
        target: input.target ?? 1,
        sortOrder: next,
      })
      .returning(columns)
      .get();
    logActivity(tx, ctx, "objective.add", {
      gameId,
      name: item.name,
      objectiveId: row.id,
      title: row.title,
      target: row.target,
    });
    return row;
  });

  return writeResult(ctx, objective, before);
}

/** Edita título, descrição, alvo e/ou progresso. O progresso é ajustado para 0..alvo. */
export function updateObjective(
  ctx: ServiceContext,
  id: number,
  patch: UpdateObjectiveInput,
): ObjectiveWriteResult {
  const current = getEditable(ctx, id);
  const target = patch.target ?? current.target;
  const progress = clamp(patch.progress ?? current.progress, target);
  return write(ctx, current, {
    ...(patch.title !== undefined && { title: patch.title }),
    ...(patch.description !== undefined && { description: patch.description || null }),
    target,
    progress,
  });
}

/** Soma (ou subtrai, com negativo) ao progresso: "peguei mais 3 sementes". */
export function incrementObjective(
  ctx: ServiceContext,
  id: number,
  by: number,
): ObjectiveWriteResult {
  const current = getEditable(ctx, id);
  return write(ctx, current, { progress: clamp(current.progress + by, current.target) });
}

/** Marca como feito (progresso = alvo) ou desfaz (progresso = 0). */
export function setObjectiveDone(
  ctx: ServiceContext,
  id: number,
  done: boolean,
): ObjectiveWriteResult {
  const current = getEditable(ctx, id);
  return write(ctx, current, { progress: done ? current.target : 0 });
}

export function deleteObjective(
  ctx: ServiceContext,
  id: number,
): { deleted: ObjectiveItem; summary: ObjectivesSummary } {
  const objective = getEditable(ctx, id);
  ctx.db.transaction((tx) => {
    tx.delete(objectives)
      .where(and(eq(objectives.id, id), eq(objectives.userId, ctx.userId)))
      .run();
    logActivity(tx, ctx, "objective.delete", { ...objective });
  });
  return { deleted: objective, summary: summarize(ctx, objective.gameId) };
}

/** Nova ordem: `ids` tem que ter exatamente os objetivos do jogo. */
export function reorderObjectives(
  ctx: ServiceContext,
  gameId: number,
  ids: number[],
): ObjectiveItem[] {
  const current = listObjectives(ctx, gameId);
  const known = new Set(current.map((o) => o.id));
  if (
    ids.length !== known.size ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => known.has(id))
  ) {
    throw new ValidationError("A nova ordem precisa ter todos os objetivos do jogo, sem repetir");
  }
  ctx.db.transaction((tx) => {
    ids.forEach((id, sortOrder) => {
      tx.update(objectives)
        .set({ sortOrder })
        .where(and(eq(objectives.id, id), eq(objectives.userId, ctx.userId)))
        .run();
    });
    logActivity(tx, ctx, "objective.reorder", { gameId, ids });
  });
  return listObjectives(ctx, gameId);
}

// ---------------------------------------------------------------------------

function clamp(progress: number, target: number): number {
  return Math.min(target, Math.max(0, progress));
}

/** Só os objetivos manuais mudam por aqui; os sincronizados vêm da fonte externa. */
function getEditable(ctx: ServiceContext, id: number): ObjectiveItem {
  const objective = getObjective(ctx, id);
  if (objective.source !== "manual") {
    throw new ValidationError("Conquistas sincronizadas não podem ser editadas aqui");
  }
  return objective;
}

function write(
  ctx: ServiceContext,
  current: ObjectiveItem,
  changes: Partial<Pick<ObjectiveItem, "title" | "description" | "target" | "progress">>,
): ObjectiveWriteResult {
  const before = summarize(ctx, current.gameId);
  const target = changes.target ?? current.target;
  const progress = changes.progress ?? current.progress;
  const done = progress >= target;
  const unlockedAt = done ? (current.unlockedAt ?? ctx.now.toISOString()) : null;

  const objective = ctx.db.transaction((tx) => {
    const row = tx
      .update(objectives)
      .set({ ...changes, unlockedAt })
      .where(and(eq(objectives.id, current.id), eq(objectives.userId, ctx.userId)))
      .returning(columns)
      .get()!;
    logActivity(tx, ctx, "objective.update", {
      gameId: current.gameId,
      objectiveId: current.id,
      title: row.title,
      changes,
    });
    return row;
  });

  return writeResult(ctx, objective, before);
}

function writeResult(
  ctx: ServiceContext,
  objective: ObjectiveItem,
  before: ObjectivesSummary,
): ObjectiveWriteResult {
  const summary = summarize(ctx, objective.gameId);
  const allDoneNow = allDone(summary) && !allDone(before);
  const best = allDoneNow ? getLibraryItem(ctx, objective.gameId).completion?.best : undefined;
  return { objective, summary, allDoneNow, suggestFullCompletion: allDoneNow && best !== "full" };
}

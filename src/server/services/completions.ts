import { and, desc, eq } from "drizzle-orm";
import type { CompletionItem, MarkCompletedInput } from "../../shared/completions";
import type { GameStatus } from "../../shared/domain";
import type { LibraryItem } from "../../shared/library";
import { completions, libraryEntries } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { logActivity } from "./activity";
import type { ServiceContext, UserScope } from "./context";
import { applyStatusRules, getLibraryItem } from "./library";

// Conclusões de um jogo: história, história + extras ou 100%, com data (replays viram outra linha).

const columns = {
  id: completions.id,
  gameId: completions.gameId,
  type: completions.type,
  completedOn: completions.completedOn,
  note: completions.note,
  createdAt: completions.createdAt,
};

/** Conclusões do jogo, da mais recente para a mais antiga. */
export function listCompletions(scope: UserScope, gameId: number): CompletionItem[] {
  getLibraryItem(scope, gameId); // 404 se o jogo não estiver na biblioteca
  return scope.db
    .select(columns)
    .from(completions)
    .where(and(eq(completions.userId, scope.userId), eq(completions.gameId, gameId)))
    .orderBy(desc(completions.completedOn), desc(completions.id))
    .all();
}

export interface MarkCompletedResult {
  completion: CompletionItem;
  item: LibraryItem;
  previousStatus: GameStatus;
}

/**
 * Registra uma conclusão (padrão: hoje). Não muda o status, a não ser com `moveToFinished`:
 * um jogo "jogando" que acabou de ser zerado fica em pós-jogo até o usuário decidir.
 */
export function markCompleted(
  ctx: ServiceContext,
  gameId: number,
  input: MarkCompletedInput,
): MarkCompletedResult {
  const current = getLibraryItem(ctx, gameId);
  const completedOn = input.date ?? ctx.today;
  if (completedOn > ctx.today)
    throw new ValidationError("A data da conclusão não pode ser no futuro");

  const moving = input.moveToFinished === true && current.status !== "finished";
  // Zerou antes do "começou em" (ex.: adicionou como jogando depois de já ter zerado): o início
  // recua para a data da conclusão, como acontece com as sessões.
  const pullsStart = current.startedAt !== null && completedOn < current.startedAt;
  const dates = moving
    ? applyStatusRules(
        current,
        {
          status: "finished",
          finishedAt: completedOn,
          ...(pullsStart && { startedAt: completedOn }),
        },
        ctx.today,
      )
    : {};

  const completion = ctx.db.transaction((tx) => {
    const row = tx
      .insert(completions)
      .values({
        userId: ctx.userId,
        gameId,
        type: input.type,
        completedOn,
        note: input.note || null,
      })
      .returning(columns)
      .get();
    if (moving) {
      tx.update(libraryEntries)
        .set({ status: "finished", ...dates })
        .where(and(eq(libraryEntries.userId, ctx.userId), eq(libraryEntries.gameId, gameId)))
        .run();
    }
    logActivity(tx, ctx, "completion.add", {
      gameId,
      name: current.name,
      completionId: row.id,
      type: row.type,
      completedOn,
      ...(moving && { status: "finished" }),
    });
    return row;
  });

  return { completion, item: getLibraryItem(ctx, gameId), previousStatus: current.status };
}

/** Apaga uma conclusão (o status do jogo não muda). */
export function removeCompletion(
  ctx: ServiceContext,
  id: number,
): { removed: CompletionItem; item: LibraryItem } {
  const completion = getCompletion(ctx, id);
  ctx.db.transaction((tx) => {
    tx.delete(completions)
      .where(and(eq(completions.id, id), eq(completions.userId, ctx.userId)))
      .run();
    logActivity(tx, ctx, "completion.remove", { ...completion });
  });
  return { removed: completion, item: getLibraryItem(ctx, completion.gameId) };
}

export function getCompletion({ db, userId }: UserScope, id: number): CompletionItem {
  const completion = db
    .select(columns)
    .from(completions)
    .where(and(eq(completions.id, id), eq(completions.userId, userId)))
    .get();
  if (!completion) throw new NotFoundError(`Conclusão ${id} não encontrada`);
  return completion;
}

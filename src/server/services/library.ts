import { and, desc, eq, type SQL, sql } from "drizzle-orm";
import { type GameStatus, gameStatuses, gameStatusLabels } from "../../shared/domain";
import {
  type AddToLibraryInput,
  estimateProgress,
  type LibraryItem,
  type LibraryListQuery,
  type RemovalSummary,
  type StatusCounts,
  type UpdateLibraryEntryInput,
} from "../../shared/library";
import type { Db } from "../db/client";
import { games, libraryEntries, playSessions } from "../db/schema";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { logActivity } from "./activity";
import type { ServiceContext } from "./context";
import { ensureGame } from "./games";
import type { IgdbApi } from "./igdb";

// ---------------------------------------------------------------------------
// Leitura

export function listLibrary(db: Db, query: LibraryListQuery = {}): LibraryItem[] {
  const filters: SQL[] = [];
  if (query.status) filters.push(eq(libraryEntries.status, query.status));
  if (query.q) filters.push(sql`${games.name} like ${`%${escapeLike(query.q)}%`} escape '\\'`);
  return selectItems(db, filters);
}

export function getLibraryItem(db: Db, gameId: number): LibraryItem {
  const [item] = selectItems(db, [eq(games.id, gameId)]);
  if (!item) throw new NotFoundError(`Jogo ${gameId} não está na biblioteca`);
  return item;
}

export function countByStatus(db: Db): StatusCounts {
  const counts = Object.fromEntries(gameStatuses.map((s) => [s, 0])) as StatusCounts;
  const rows = db
    .select({ status: libraryEntries.status, count: sql<number>`count(*)` })
    .from(libraryEntries)
    .groupBy(libraryEntries.status)
    .all();
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

function selectItems(db: Db, filters: SQL[]): LibraryItem[] {
  const totals = db
    .select({
      gameId: playSessions.gameId,
      minutes: sql<number>`sum(${playSessions.minutes})`.as("minutes"),
      sessions: sql<number>`count(*)`.as("sessions"),
      lastPlayedOn: sql<string>`max(${playSessions.playedOn})`.as("last_played_on"),
    })
    .from(playSessions)
    .groupBy(playSessions.gameId)
    .as("totals");

  const rows = db
    .select({
      game: games,
      entry: libraryEntries,
      minutes: sql<number>`coalesce(${totals.minutes}, 0)`,
      sessions: sql<number>`coalesce(${totals.sessions}, 0)`,
      lastPlayedOn: totals.lastPlayedOn,
    })
    .from(libraryEntries)
    .innerJoin(games, eq(games.id, libraryEntries.gameId))
    .leftJoin(totals, eq(totals.gameId, games.id))
    .where(and(...filters))
    // Jogados recentemente primeiro; depois os mexidos por último.
    .orderBy(
      sql`${totals.lastPlayedOn} desc nulls last`,
      desc(libraryEntries.updatedAt),
      desc(libraryEntries.id),
    )
    .all();

  return rows.map(({ game, entry, minutes, sessions, lastPlayedOn }) => {
    const hasTtb =
      game.ttbMainSec !== null || game.ttbExtraSec !== null || game.ttbCompleteSec !== null;
    return {
      gameId: game.id,
      igdbId: game.igdbId,
      name: game.name,
      slug: game.slug,
      coverImageId: game.coverImageId,
      platforms: game.platforms,
      genres: game.genres,
      releaseYear: game.releaseYear,
      timeToBeat: hasTtb
        ? { mainSec: game.ttbMainSec, extraSec: game.ttbExtraSec, completeSec: game.ttbCompleteSec }
        : null,
      status: entry.status,
      platformPlayed: entry.platformPlayed,
      startedAt: entry.startedAt,
      finishedAt: entry.finishedAt,
      rating: entry.rating,
      notes: entry.notes,
      addedAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      minutesPlayed: minutes,
      sessionsCount: sessions,
      lastPlayedOn: lastPlayedOn ?? null,
      progress: estimateProgress(minutes, game.ttbMainSec),
    };
  });
}

// ---------------------------------------------------------------------------
// Escrita

export async function addToLibrary(
  ctx: ServiceContext,
  igdb: IgdbApi,
  input: AddToLibraryInput,
): Promise<LibraryItem> {
  const game = await ensureGame(ctx.db, igdb, input.igdbId);

  const existing = ctx.db
    .select({ status: libraryEntries.status })
    .from(libraryEntries)
    .where(eq(libraryEntries.gameId, game.id))
    .get();
  if (existing) {
    throw new ConflictError(
      `"${game.name}" já está na biblioteca (${gameStatusLabels[existing.status]})`,
    );
  }

  const dates = applyStatusRules(null, { status: input.status }, ctx.today);
  ctx.db.transaction((tx) => {
    tx.insert(libraryEntries)
      .values({
        gameId: game.id,
        status: input.status,
        platformPlayed: input.platformPlayed ?? null,
        ...dates,
      })
      .run();
    logActivity(tx, ctx.actor, "library.add", {
      gameId: game.id,
      name: game.name,
      status: input.status,
    });
  });

  return getLibraryItem(ctx.db, game.id);
}

export function updateLibraryEntry(
  ctx: ServiceContext,
  gameId: number,
  patch: UpdateLibraryEntryInput,
): LibraryItem {
  const current = getLibraryItem(ctx.db, gameId);
  const dates = applyStatusRules(current, patch, ctx.today);

  const changes = {
    ...(patch.status !== undefined && { status: patch.status }),
    ...(patch.rating !== undefined && { rating: patch.rating }),
    ...(patch.notes !== undefined && { notes: patch.notes || null }),
    ...(patch.platformPlayed !== undefined && { platformPlayed: patch.platformPlayed }),
    ...dates,
  };

  ctx.db.transaction((tx) => {
    tx.update(libraryEntries).set(changes).where(eq(libraryEntries.gameId, gameId)).run();
    logActivity(tx, ctx.actor, "library.update", {
      gameId,
      name: current.name,
      changes,
    });
  });

  return getLibraryItem(ctx.db, gameId);
}

/** O que seria apagado ao remover o jogo (usado para confirmação no site e no MCP). */
export function previewRemoval(db: Db, gameId: number): RemovalSummary {
  const item = getLibraryItem(db, gameId);
  return {
    gameId,
    name: item.name,
    sessionsCount: item.sessionsCount,
    minutesPlayed: item.minutesPlayed,
  };
}

/** Remove o jogo da biblioteca junto com todas as sessões dele. */
export function removeFromLibrary(ctx: ServiceContext, gameId: number): RemovalSummary {
  const summary = previewRemoval(ctx.db, gameId);
  ctx.db.transaction((tx) => {
    // Apagar o jogo leva a entrada e as sessões junto (ON DELETE CASCADE).
    tx.delete(games).where(eq(games.id, gameId)).run();
    logActivity(tx, ctx.actor, "library.remove", { ...summary });
  });
  return summary;
}

// ---------------------------------------------------------------------------
// Regras de status e datas

interface EntryDates {
  status: GameStatus;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * Calcula started_at/finished_at a partir da mudança:
 * - virou "jogando" sem data de início → começa hoje
 * - virou "zerado" → termina hoje (ou na data informada)
 * - saiu de "zerado" → limpa a data de término
 * Datas futuras e término antes do início são rejeitados.
 */
export function applyStatusRules(
  current: EntryDates | null,
  patch: Pick<UpdateLibraryEntryInput, "status" | "startedAt" | "finishedAt">,
  today: string,
): { startedAt?: string | null; finishedAt?: string | null } {
  const status = patch.status ?? current?.status;
  let startedAt = patch.startedAt !== undefined ? patch.startedAt : (current?.startedAt ?? null);
  let finishedAt =
    patch.finishedAt !== undefined ? patch.finishedAt : (current?.finishedAt ?? null);

  if (status === "playing" && !startedAt) startedAt = today;
  if (status === "finished") finishedAt ??= today;
  else finishedAt = null;

  for (const [label, date] of [
    ["início", startedAt],
    ["término", finishedAt],
  ] as const) {
    if (date && date > today)
      throw new ValidationError(`A data de ${label} não pode ser no futuro`);
  }
  if (startedAt && finishedAt && finishedAt < startedAt) {
    throw new ValidationError("A data de término não pode ser antes da data de início");
  }

  const result: { startedAt?: string | null; finishedAt?: string | null } = {};
  if (startedAt !== (current?.startedAt ?? null)) result.startedAt = startedAt;
  if (finishedAt !== (current?.finishedAt ?? null)) result.finishedAt = finishedAt;
  return result;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

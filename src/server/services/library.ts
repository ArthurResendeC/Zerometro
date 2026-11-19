import { isNotNull, and, desc, eq, type SQL, sql } from "drizzle-orm";
import { type GameStatus, gameStatuses, gameStatusLabels } from "../../shared/domain";
import {
  type AddToLibraryInput,
  estimateProgress,
  type LibraryItem,
  type LibraryListQuery,
  type RemovalSummary,
  type StatusCounts,
  type UpdateLibraryEntryInput,
  type UpdateLibraryEntryResult,
} from "../../shared/library";
import { games, libraryEntries, playSessions } from "../db/schema";
import { AmbiguousGameError, ConflictError, NotFoundError, ValidationError } from "../errors";
import { logActivity } from "./activity";
import type { ServiceContext, UserScope } from "./context";
import { ensureGame } from "./games";
import type { IgdbApi } from "./igdb";

// ---------------------------------------------------------------------------
// Leitura

export function listLibrary(scope: UserScope, query: LibraryListQuery = {}): LibraryItem[] {
  const filters: SQL[] = [];
  if (query.status) filters.push(eq(libraryEntries.status, query.status));
  if (query.q) filters.push(sql`${games.name} like ${`%${escapeLike(query.q)}%`} escape '\\'`);
  return selectItems(scope, filters);
}

export function getLibraryItem(scope: UserScope, gameId: number): LibraryItem {
  const [item] = selectItems(scope, [eq(games.id, gameId)]);
  if (!item) throw new NotFoundError(`Jogo ${gameId} não está na biblioteca`);
  return item;
}

/** Minúsculas e sem acento, para comparar nomes ("Pokémon" = "pokemon"). */
const normalizeName = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");

/**
 * Acha um jogo da biblioteca pelo id ou pelo nome (usado pelo MCP: "joguei Persona").
 * Nome exato (sem diferenciar maiúsculas e acentos) ganha; senão, vale um único nome que
 * contenha o termo. Mais de um candidato → AmbiguousGameError com as opções, sem chutar.
 */
export function resolveLibraryGame(scope: UserScope, ref: string | number): LibraryItem {
  if (typeof ref === "number") return getLibraryItem(scope, ref);
  // Texto só com dígitos é tentado como id; se não for, segue como nome (ex.: "2048").
  if (/^\d+$/.test(ref.trim())) {
    const [byId] = selectItems(scope, [eq(games.id, Number(ref))]);
    if (byId) return byId;
  }

  const term = normalizeName(ref);
  if (!term) throw new ValidationError("Informe o nome ou o id do jogo");
  const items = listLibrary(scope);
  const exact = items.filter((item) => normalizeName(item.name) === term);
  const candidates =
    exact.length > 0 ? exact : items.filter((item) => normalizeName(item.name).includes(term));

  const [only] = candidates;
  if (candidates.length === 1 && only) return only;
  if (candidates.length === 0) {
    throw new NotFoundError(`Nenhum jogo da biblioteca com "${ref}" no nome`);
  }
  throw new AmbiguousGameError(
    `"${ref}" bate com ${candidates.length} jogos: ${candidates.map((c) => `${c.name} (id ${c.gameId})`).join(", ")}. Use o id.`,
    candidates.map(({ gameId, name }) => ({ gameId, name })),
  );
}

export function countByStatus({ db, userId }: UserScope): StatusCounts {
  const counts = Object.fromEntries(gameStatuses.map((s) => [s, 0])) as StatusCounts;
  const rows = db
    .select({ status: libraryEntries.status, count: sql<number>`count(*)` })
    .from(libraryEntries)
    .where(eq(libraryEntries.userId, userId))
    .groupBy(libraryEntries.status)
    .all();
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

function selectItems({ db, userId }: UserScope, filters: SQL[]): LibraryItem[] {
  const totals = db
    .select({
      gameId: playSessions.gameId,
      minutes: sql<number>`sum(${playSessions.minutes})`.as("minutes"),
      sessions: sql<number>`count(*)`.as("sessions"),
      lastPlayedOn: sql<string>`max(${playSessions.playedOn})`.as("last_played_on"),
    })
    .from(playSessions)
    // Só sessões encerradas do usuário (ignora o timer rodando).
    .where(and(eq(playSessions.userId, userId), isNotNull(playSessions.minutes)))
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
    .where(and(eq(libraryEntries.userId, userId), ...filters))
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
    .where(and(eq(libraryEntries.userId, ctx.userId), eq(libraryEntries.gameId, game.id)))
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
        userId: ctx.userId,
        gameId: game.id,
        status: input.status,
        platformPlayed: input.platformPlayed ?? null,
        ...dates,
      })
      .run();
    logActivity(tx, ctx, "library.add", {
      gameId: game.id,
      name: game.name,
      status: input.status,
    });
  });

  return getLibraryItem(ctx, game.id);
}

export function updateLibraryEntry(
  ctx: ServiceContext,
  gameId: number,
  patch: UpdateLibraryEntryInput,
): UpdateLibraryEntryResult {
  const current = getLibraryItem(ctx, gameId);
  const dates = applyStatusRules(current, patch, ctx.today);

  const changes = {
    ...(patch.status !== undefined && { status: patch.status }),
    ...(patch.rating !== undefined && { rating: patch.rating }),
    ...(patch.notes !== undefined && { notes: patch.notes || null }),
    ...(patch.platformPlayed !== undefined && { platformPlayed: patch.platformPlayed }),
    ...dates,
  };

  ctx.db.transaction((tx) => {
    tx.update(libraryEntries)
      .set(changes)
      .where(and(eq(libraryEntries.userId, ctx.userId), eq(libraryEntries.gameId, gameId)))
      .run();
    logActivity(tx, ctx, "library.update", {
      gameId,
      name: current.name,
      changes,
    });
  });

  return { item: getLibraryItem(ctx, gameId), previousStatus: current.status };
}

/** O que seria apagado ao remover o jogo (usado para confirmação no site e no MCP). */
export function previewRemoval(scope: UserScope, gameId: number): RemovalSummary {
  const item = getLibraryItem(scope, gameId);
  return {
    gameId,
    name: item.name,
    sessionsCount: item.sessionsCount,
    minutesPlayed: item.minutesPlayed,
  };
}

/** Remove o jogo da biblioteca junto com todas as sessões dele. */
export function removeFromLibrary(ctx: ServiceContext, gameId: number): RemovalSummary {
  const summary = previewRemoval(ctx, gameId);
  ctx.db.transaction((tx) => {
    // O jogo continua no cache do IGDB (`games`, compartilhado); saem só os dados do usuário.
    tx.delete(playSessions)
      .where(and(eq(playSessions.userId, ctx.userId), eq(playSessions.gameId, gameId)))
      .run();
    tx.delete(libraryEntries)
      .where(and(eq(libraryEntries.userId, ctx.userId), eq(libraryEntries.gameId, gameId)))
      .run();
    logActivity(tx, ctx, "library.remove", { ...summary });
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

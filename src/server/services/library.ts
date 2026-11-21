import { isNotNull, and, desc, eq, inArray, isNull, ne, type SQL, sql } from "drizzle-orm";
import { displayStateOf, estimateProgress } from "../../shared/completions";
import {
  type CompletionType,
  completionTypes,
  type GameStatus,
  gameStatuses,
  type PlaytimeSource,
  gameStatusLabels,
} from "../../shared/domain";
import {
  type AddToLibraryInput,
  type LibraryItem,
  type LibraryListQuery,
  type RemovalSummary,
  type StatusCounts,
  type UpdateLibraryEntryInput,
  type UpdateLibraryEntryResult,
} from "../../shared/library";
import {
  achievementSets,
  achievementUnlocks,
  achievements,
  completions,
  games,
  libraryEntries,
  objectives,
  playSessions,
  userAchievementSets,
} from "../db/schema";
import { AmbiguousGameError, ConflictError, NotFoundError, ValidationError } from "../errors";
import { logActivity } from "./activity";
import type { DbOrTx } from "../db/client";
import type { ServiceContext, UserScope } from "./context";
import { ensureGame } from "./games";
import type { IgdbApi } from "./igdb";

// ---------------------------------------------------------------------------
// Leitura

export function listLibrary(scope: UserScope, query: LibraryListQuery = {}): LibraryItem[] {
  const filters: SQL[] = [];
  if (query.status) filters.push(eq(libraryEntries.status, query.status));
  if (query.q) filters.push(sql`${games.name} like ${`%${escapeLike(query.q)}%`} escape '\\'`);
  if (query.displayState === "postgame") filters.push(isPostgame(scope.userId));
  return selectItems(scope, filters);
}

/** Jogando um jogo que já tem conclusão. */
function isPostgame(userId: string): SQL {
  return sql`${libraryEntries.status} = 'playing' and exists (select 1 from ${completions} where ${completions.userId} = ${userId} and ${completions.gameId} = ${games.id})`;
}

export function getLibraryItem(scope: UserScope, gameId: number): LibraryItem {
  const [item] = selectItems(scope, [eq(games.id, gameId)]);
  if (!item) throw new NotFoundError(`Jogo ${gameId} não está na biblioteca`);
  return item;
}

/** O item da biblioteca pelo id do IGDB; null se o jogo não estiver nela. */
export function findLibraryItemByIgdbId(scope: UserScope, igdbId: number): LibraryItem | null {
  return selectItems(scope, [eq(games.igdbId, igdbId)])[0] ?? null;
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

/** Quantos jogos estão em pós-jogo (contados também em "Jogando"). */
export function countPostgame({ db, userId }: UserScope): number {
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(libraryEntries)
      .innerJoin(games, eq(games.id, libraryEntries.gameId))
      .where(and(eq(libraryEntries.userId, userId), isPostgame(userId)))
      .get()?.count ?? 0
  );
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

  const done = db
    .select({
      gameId: completions.gameId,
      // Posição do melhor tipo em `completionTypes` (0 história, 1 + extras, 2 100%).
      bestRank: sql<number>`max(case ${completions.type} ${sql.raw(
        completionTypes.map((type, rank) => `when '${type}' then ${rank}`).join(" "),
      )} end)`.as("best_rank"),
      count: sql<number>`count(*)`.as("completions"),
      first: sql<string>`min(${completions.completedOn})`.as("first_completed_on"),
      last: sql<string>`max(${completions.completedOn})`.as("last_completed_on"),
    })
    .from(completions)
    .where(eq(completions.userId, userId))
    .groupBy(completions.gameId)
    .as("done");

  const goals = db
    .select({
      gameId: objectives.gameId,
      total: sql<number>`count(*)`.as("objectives_total"),
      unlocked: sql<number>`sum(${objectives.progress} >= ${objectives.target})`.as(
        "objectives_unlocked",
      ),
    })
    .from(objectives)
    .where(eq(objectives.userId, userId))
    .groupBy(objectives.gameId)
    .as("goals");

  // Conquistas das listas que cada jogo segue (sem as removidas da fonte).
  const trophies = db
    .select({
      gameId: userAchievementSets.gameId,
      total: sql<number>`count(*)`.as("achievements_total"),
      unlocked: sql<number>`count(${achievementUnlocks.id})`.as("achievements_unlocked"),
      points: sql<number>`coalesce(sum(${achievements.points}), 0)`.as("achievements_points"),
      pointsUnlocked:
        sql<number>`coalesce(sum(case when ${achievementUnlocks.id} is not null then ${achievements.points} end), 0)`.as(
          "achievements_points_unlocked",
        ),
    })
    .from(userAchievementSets)
    .innerJoin(
      achievements,
      and(eq(achievements.setId, userAchievementSets.setId), isNull(achievements.removedAt)),
    )
    .leftJoin(
      achievementUnlocks,
      and(
        eq(achievementUnlocks.achievementId, achievements.id),
        eq(achievementUnlocks.userId, userId),
      ),
    )
    .where(eq(userAchievementSets.userId, userId))
    .groupBy(userAchievementSets.gameId)
    .as("trophies");

  // Jogos que seguem uma lista da Steam (ligada pelo IGDB ou colando a URL da loja).
  const steamLinks = db
    .select({ gameId: userAchievementSets.gameId })
    .from(userAchievementSets)
    .innerJoin(achievementSets, eq(achievementSets.id, userAchievementSets.setId))
    .where(and(eq(userAchievementSets.userId, userId), eq(achievementSets.source, "steam")))
    .groupBy(userAchievementSets.gameId)
    .as("steam_links");

  const rows = db
    .select({
      game: games,
      entry: libraryEntries,
      followsSteamSet: sql<boolean>`${steamLinks.gameId} is not null`.mapWith(Boolean),
      minutes: sql<number>`coalesce(${totals.minutes}, 0)`,
      sessions: sql<number>`coalesce(${totals.sessions}, 0)`,
      lastPlayedOn: totals.lastPlayedOn,
      bestRank: done.bestRank,
      completions: done.count,
      firstCompletedOn: done.first,
      lastCompletedOn: done.last,
      objectivesTotal: goals.total,
      objectivesUnlocked: goals.unlocked,
      achievementsTotal: trophies.total,
      achievementsUnlocked: trophies.unlocked,
      achievementsPoints: trophies.points,
      achievementsPointsUnlocked: trophies.pointsUnlocked,
    })
    .from(libraryEntries)
    .innerJoin(games, eq(games.id, libraryEntries.gameId))
    .leftJoin(totals, eq(totals.gameId, games.id))
    .leftJoin(done, eq(done.gameId, games.id))
    .leftJoin(goals, eq(goals.gameId, games.id))
    .leftJoin(trophies, eq(trophies.gameId, games.id))
    .leftJoin(steamLinks, eq(steamLinks.gameId, games.id))
    .where(and(eq(libraryEntries.userId, userId), ...filters))
    // Jogados recentemente primeiro; depois os mexidos por último.
    .orderBy(
      sql`${totals.lastPlayedOn} desc nulls last`,
      desc(libraryEntries.updatedAt),
      desc(libraryEntries.id),
    )
    .all();

  return rows.map((row) => {
    const { game, entry, minutes, sessions, lastPlayedOn } = row;
    const hasTtb =
      game.ttbMainSec !== null || game.ttbExtraSec !== null || game.ttbCompleteSec !== null;
    const timeToBeat = hasTtb
      ? { mainSec: game.ttbMainSec, extraSec: game.ttbExtraSec, completeSec: game.ttbCompleteSec }
      : null;
    const best: CompletionType | null =
      row.bestRank === null ? null : (completionTypes[row.bestRank] ?? null);
    const completion =
      best && row.firstCompletedOn && row.lastCompletedOn
        ? {
            best,
            count: row.completions ?? 0,
            firstCompletedOn: row.firstCompletedOn,
            lastCompletedOn: row.lastCompletedOn,
          }
        : null;
    const steamPlaytime =
      entry.steamMinutes !== null && entry.steamSyncedAt
        ? { minutes: entry.steamMinutes, syncedAt: entry.steamSyncedAt }
        : null;
    const minutesPlayed =
      entry.playtimeSource === "steam" && steamPlaytime
        ? steamPlaytime.minutes
        : minutes + entry.priorMinutes;
    const estimate = estimateProgress(minutesPlayed, timeToBeat, best);
    const onSteam =
      game.steamAppId !== null || row.followsSteamSet || steamPlaytime !== null
        ? true
        : game.steamCheckedAt === null
          ? null
          : false;
    return {
      gameId: game.id,
      igdbId: game.igdbId,
      name: game.name,
      slug: game.slug,
      coverImageId: game.coverImageId,
      platforms: game.platforms,
      genres: game.genres,
      releaseYear: game.releaseYear,
      timeToBeat,
      status: entry.status,
      displayState: displayStateOf(entry.status, completion),
      completion,
      objectives: row.objectivesTotal
        ? { total: row.objectivesTotal, unlocked: row.objectivesUnlocked ?? 0 }
        : null,
      achievements: row.achievementsTotal
        ? {
            total: row.achievementsTotal,
            unlocked: row.achievementsUnlocked ?? 0,
            points: row.achievementsPoints ?? 0,
            pointsUnlocked: row.achievementsPointsUnlocked ?? 0,
          }
        : null,
      platformPlayed: entry.platformPlayed,
      startedAt: entry.startedAt,
      finishedAt: entry.finishedAt,
      rating: entry.rating,
      notes: entry.notes,
      addedAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      minutesPlayed,
      sessionMinutes: minutes,
      priorMinutes: entry.priorMinutes,
      playtimeSource: entry.playtimeSource,
      steamPlaytime,
      onSteam,
      sessionsCount: sessions,
      lastPlayedOn: lastPlayedOn ?? null,
      progress: estimate.progress,
      progressTarget: estimate.target,
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

  ctx.db.transaction((tx) => {
    insertLibraryEntry(tx, ctx, game, {
      status: input.status,
      platformPlayed: input.platformPlayed ?? null,
      priorMinutes: input.priorMinutes ?? 0,
    });
  });

  return getLibraryItem(ctx, game.id);
}

export interface NewLibraryEntry {
  status: GameStatus;
  platformPlayed?: string | null;
  priorMinutes?: number;
  playtimeSource?: PlaytimeSource;
  /** Total na Steam já conhecido (a importação traz da conta). */
  steamMinutes?: number | null;
}

/**
 * Grava a entrada de um jogo que ainda não está na biblioteca (quem chama confere antes; o índice
 * único barra a repetição), com as datas do status, a conclusão se já vem zerado e o histórico.
 */
export function insertLibraryEntry(
  tx: DbOrTx,
  ctx: ServiceContext,
  game: { id: number; name: string },
  entry: NewLibraryEntry,
  log: Record<string, unknown> = {},
): void {
  const dates = applyStatusRules(null, { status: entry.status }, ctx.today);
  tx.insert(libraryEntries)
    .values({
      userId: ctx.userId,
      gameId: game.id,
      status: entry.status,
      platformPlayed: entry.platformPlayed ?? null,
      priorMinutes: entry.priorMinutes ?? 0,
      playtimeSource: entry.playtimeSource ?? "sessions",
      steamMinutes: entry.steamMinutes ?? null,
      // O total que já vem é "antes": só o jogado daqui em diante vira sessão.
      ...(entry.steamMinutes != null && {
        steamCountedMinutes: entry.steamMinutes,
        steamCountedAt: ctx.now.toISOString(),
      }),
      ...dates,
    })
    .run();
  if (entry.status === "finished") ensureCompletion(tx, ctx.userId, game.id, ctx.today);
  logActivity(tx, ctx, "library.add", {
    gameId: game.id,
    name: game.name,
    status: entry.status,
    ...(entry.priorMinutes && { priorMinutes: entry.priorMinutes }),
    ...log,
  });
}

export function updateLibraryEntry(
  ctx: ServiceContext,
  gameId: number,
  patch: UpdateLibraryEntryInput,
): UpdateLibraryEntryResult {
  const current = getLibraryItem(ctx, gameId);
  if (patch.playtimeSource === "steam" && !current.steamPlaytime) {
    throw new ValidationError(
      `Sincronize "${current.name}" com a Steam antes de usar o tempo jogado de lá`,
    );
  }
  const dates = applyStatusRules(current, patch, ctx.today);

  const changes = {
    ...(patch.status !== undefined && { status: patch.status }),
    ...(patch.rating !== undefined && { rating: patch.rating }),
    ...(patch.notes !== undefined && { notes: patch.notes || null }),
    ...(patch.platformPlayed !== undefined && { platformPlayed: patch.platformPlayed }),
    ...(patch.priorMinutes !== undefined && { priorMinutes: patch.priorMinutes }),
    ...(patch.playtimeSource !== undefined && { playtimeSource: patch.playtimeSource }),
    ...dates,
  };

  ctx.db.transaction((tx) => {
    tx.update(libraryEntries)
      .set(changes)
      .where(and(eq(libraryEntries.userId, ctx.userId), eq(libraryEntries.gameId, gameId)))
      .run();
    if (patch.status === "finished") {
      ensureCompletion(tx, ctx.userId, gameId, dates.finishedAt ?? current.finishedAt ?? ctx.today);
    }
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
  const count = (table: typeof completions | typeof objectives) =>
    scope.db
      .select({ count: sql<number>`count(*)` })
      .from(table)
      .where(and(eq(table.userId, scope.userId), eq(table.gameId, gameId)))
      .get()?.count ?? 0;
  return {
    gameId,
    name: item.name,
    sessionsCount: item.sessionsCount,
    minutesPlayed: item.minutesPlayed,
    completionsCount: count(completions),
    objectivesCount: count(objectives),
    achievementsUnlocked: item.achievements?.unlocked ?? 0,
  };
}

/** Remove o jogo da biblioteca junto com as sessões, conclusões e objetivos dele. */
export function removeFromLibrary(ctx: ServiceContext, gameId: number): RemovalSummary {
  const summary = previewRemoval(ctx, gameId);
  ctx.db.transaction((tx) => {
    // O jogo continua no cache do IGDB (`games`, compartilhado); saem só os dados do usuário.
    for (const table of [playSessions, completions, objectives]) {
      tx.delete(table)
        .where(and(eq(table.userId, ctx.userId), eq(table.gameId, gameId)))
        .run();
    }
    removeAchievementData(tx, ctx.userId, gameId);
    tx.delete(libraryEntries)
      .where(and(eq(libraryEntries.userId, ctx.userId), eq(libraryEntries.gameId, gameId)))
      .run();
    logActivity(tx, ctx, "library.remove", { ...summary });
  });
  return summary;
}

/**
 * Tira as listas de conquistas do jogo e os desbloqueios delas. Uma lista que outro jogo da
 * biblioteca também segue fica com os desbloqueios (são da lista, não do jogo).
 */
function removeAchievementData(db: DbOrTx, userId: string, gameId: number) {
  const ofUser = eq(userAchievementSets.userId, userId);
  const setIds = db
    .select({ setId: userAchievementSets.setId })
    .from(userAchievementSets)
    .where(and(ofUser, eq(userAchievementSets.gameId, gameId)))
    .all()
    .map((row) => row.setId);
  if (setIds.length === 0) return;

  const stillFollowed = new Set(
    db
      .select({ setId: userAchievementSets.setId })
      .from(userAchievementSets)
      .where(and(ofUser, ne(userAchievementSets.gameId, gameId)))
      .all()
      .map((row) => row.setId),
  );
  const orphaned = setIds.filter((id) => !stillFollowed.has(id));

  db.delete(userAchievementSets)
    .where(and(ofUser, eq(userAchievementSets.gameId, gameId)))
    .run();
  if (orphaned.length === 0) return;
  const inOrphanedSets = db
    .select({ id: achievements.id })
    .from(achievements)
    .where(inArray(achievements.setId, orphaned));
  db.delete(achievementUnlocks)
    .where(
      and(
        eq(achievementUnlocks.userId, userId),
        inArray(achievementUnlocks.achievementId, inOrphanedSets),
      ),
    )
    .run();
}

// ---------------------------------------------------------------------------
// Regras de status e datas

/**
 * Virar "zerado" sem nenhuma conclusão cria a da história na data de término (o fluxo antigo de
 * "mudar o status para zerado", no site e no `set_status` do MCP). Com conclusão, não duplica.
 */
function ensureCompletion(db: DbOrTx, userId: string, gameId: number, completedOn: string) {
  const existing = db
    .select({ id: completions.id })
    .from(completions)
    .where(and(eq(completions.userId, userId), eq(completions.gameId, gameId)))
    .get();
  if (!existing) db.insert(completions).values({ userId, gameId, type: "main", completedOn }).run();
}

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

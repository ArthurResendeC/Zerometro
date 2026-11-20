import { and, desc, eq, gte, isNotNull, lte, ne, type SQL, sql } from "drizzle-orm";
import { nextOccurrence, zonedParts, zonedToInstant } from "../../shared/dates";
import type { GameStatus, SessionSource } from "../../shared/domain";
import {
  type ListSessionsQuery,
  type LogSessionInput,
  type LogSessionResult,
  MAX_MINUTES_PER_DAY,
  type PlaySessionItem,
  type UpdateSessionInput,
} from "../../shared/sessions";
import type { DbOrTx } from "../db/client";
import { games, libraryEntries, playSessions } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { logActivity } from "./activity";
import type { ServiceContext, UserScope } from "./context";
import { currentStreak } from "./stats";

/** Registrar uma sessão desses status indica que voltei a jogar. */
const RESUMES_PLAYING: ReadonlySet<GameStatus> = new Set(["backlog", "wishlist", "paused"]);

/** Sessões encerradas (o timer rodando tem `minutes` nulo e fica de fora das listas e totais). */
const isClosed = isNotNull(playSessions.minutes);

// ---------------------------------------------------------------------------
// Leitura

export function listSessions(
  { db, userId }: UserScope,
  query: ListSessionsQuery = {},
): PlaySessionItem[] {
  const filters: SQL[] = [eq(playSessions.userId, userId), isClosed];
  if (query.gameId) filters.push(eq(playSessions.gameId, query.gameId));
  if (query.from) filters.push(gte(playSessions.playedOn, query.from));
  if (query.to) filters.push(lte(playSessions.playedOn, query.to));

  return selectSessions(db)
    .where(and(...filters))
    .orderBy(desc(playSessions.playedOn), desc(playSessions.startedAt), desc(playSessions.id))
    .limit(query.limit ?? 100)
    .all();
}

export function getSession({ db, userId }: UserScope, id: number): PlaySessionItem {
  const session = selectSessions(db)
    .where(and(eq(playSessions.id, id), eq(playSessions.userId, userId), isClosed))
    .get();
  if (!session) throw new NotFoundError(`Sessão ${id} não encontrada`);
  return session;
}

function selectSessions(db: DbOrTx) {
  return db
    .select({
      id: playSessions.id,
      gameId: playSessions.gameId,
      gameName: games.name,
      coverImageId: games.coverImageId,
      playedOn: playSessions.playedOn,
      // Só sessões encerradas passam pelos filtros, então os minutos nunca são nulos aqui.
      minutes: sql<number>`${playSessions.minutes}`,
      startedAt: playSessions.startedAt,
      endedAt: playSessions.endedAt,
      note: playSessions.note,
      source: playSessions.source,
      createdAt: playSessions.createdAt,
      updatedAt: playSessions.updatedAt,
    })
    .from(playSessions)
    .innerJoin(games, eq(games.id, playSessions.gameId));
}

/** Minutos jogados num dia (todos os jogos), opcionalmente ignorando uma sessão. */
export function minutesOnDay(
  { db, userId }: UserScope,
  playedOn: string,
  excludeSessionId?: number,
): number {
  const filters = [eq(playSessions.userId, userId), eq(playSessions.playedOn, playedOn)];
  if (excludeSessionId) filters.push(ne(playSessions.id, excludeSessionId));
  return (
    db
      .select({ total: sql<number>`coalesce(sum(${playSessions.minutes}), 0)` })
      .from(playSessions)
      .where(and(...filters))
      .get()?.total ?? 0
  );
}

export function minutesOnGame({ db, userId }: UserScope, gameId: number): number {
  return (
    db
      .select({ total: sql<number>`coalesce(sum(${playSessions.minutes}), 0)` })
      .from(playSessions)
      .where(and(eq(playSessions.userId, userId), eq(playSessions.gameId, gameId)))
      .get()?.total ?? 0
  );
}

export interface LibraryEntryRef {
  gameId: number;
  name: string;
  status: GameStatus;
  startedAt: string | null;
  finishedAt: string | null;
}

export function findLibraryEntry({ db, userId }: UserScope, gameId: number): LibraryEntryRef {
  const entry = db
    .select({
      gameId: libraryEntries.gameId,
      name: games.name,
      status: libraryEntries.status,
      startedAt: libraryEntries.startedAt,
      finishedAt: libraryEntries.finishedAt,
    })
    .from(libraryEntries)
    .innerJoin(games, eq(games.id, libraryEntries.gameId))
    .where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.gameId, gameId)))
    .get();
  if (!entry) throw new NotFoundError(`Jogo ${gameId} não está na biblioteca`);
  return entry;
}

// ---------------------------------------------------------------------------
// Escrita

export function logSession(
  ctx: ServiceContext,
  input: LogSessionInput,
  options: { source?: SessionSource } = {},
): LogSessionResult {
  // Reenvio da fila offline (resposta perdida, duas abas): devolve a sessão que já chegou.
  const existingId = input.clientId && findSessionIdByClientId(ctx, input.clientId);
  if (existingId) return savedSessionResult(ctx, existingId);

  const playedOn = input.playedOn ?? ctx.today;
  const source = options.source ?? (ctx.actor === "mcp" ? "mcp" : "manual");
  assertNotFuture(playedOn, ctx.today);
  const entry = findLibraryEntry(ctx, input.gameId);
  const streakBefore = currentStreak(ctx, ctx.today);

  return ctx.db.transaction((tx) => {
    const scope = { db: tx, userId: ctx.userId };
    assertDayCapacity(scope, playedOn, input.minutes);

    const { id } = tx
      .insert(playSessions)
      .values({
        userId: ctx.userId,
        gameId: input.gameId,
        playedOn,
        minutes: input.minutes,
        note: input.note || null,
        source,
        clientId: input.clientId ?? null,
      })
      .returning({ id: playSessions.id })
      .get();

    const statusChangedTo = applySessionToEntry(scope, entry, playedOn);

    logActivity(tx, ctx, "session.log", {
      sessionId: id,
      gameId: input.gameId,
      name: entry.name,
      playedOn,
      minutes: input.minutes,
      ...(statusChangedTo && { statusChangedTo }),
    });

    return {
      session: getSession(scope, id),
      dayTotalMinutes: minutesOnDay(scope, playedOn),
      gameTotalMinutes: minutesOnGame(scope, input.gameId),
      statusChangedTo,
      streak: { before: streakBefore, current: currentStreak(scope, ctx.today) },
    };
  });
}

/** Sessão (encerrada ou o timer rodando) que veio do aparelho com esse `clientId`. */
export function findSessionIdByClientId({ db, userId }: UserScope, clientId: string) {
  return db
    .select({ id: playSessions.id })
    .from(playSessions)
    .where(and(eq(playSessions.userId, userId), eq(playSessions.clientId, clientId)))
    .get()?.id;
}

/** Resultado de uma sessão já gravada, para reenvios: totais atuais e a ofensiva sem mudança. */
export function savedSessionResult(ctx: ServiceContext, id: number): LogSessionResult {
  const session = getSession(ctx, id);
  const streak = currentStreak(ctx, ctx.today);
  return {
    session,
    dayTotalMinutes: minutesOnDay(ctx, session.playedOn),
    gameTotalMinutes: minutesOnGame(ctx, session.gameId),
    statusChangedTo: null,
    streak: { before: streak, current: streak },
    alreadySaved: true,
  };
}

export function updateSession(
  ctx: ServiceContext,
  id: number,
  patch: UpdateSessionInput,
): PlaySessionItem {
  const current = getSession(ctx, id);
  const changes = current.startedAt
    ? timerSessionChanges(ctx, current, patch)
    : manualSessionChanges(current, patch);
  const playedOn = changes.playedOn ?? current.playedOn;
  const minutes = changes.minutes ?? current.minutes;
  assertNotFuture(playedOn, ctx.today);

  return ctx.db.transaction((tx) => {
    const scope = { db: tx, userId: ctx.userId };
    assertDayCapacity(scope, playedOn, minutes, id);
    const set = {
      ...changes,
      ...(patch.note !== undefined && { note: patch.note || null }),
    };
    tx.update(playSessions)
      .set(set)
      .where(and(eq(playSessions.id, id), eq(playSessions.userId, ctx.userId)))
      .run();
    if (playedOn !== current.playedOn) {
      applySessionToEntry(scope, findLibraryEntry(scope, current.gameId), playedOn, {
        resume: false,
      });
    }
    logActivity(tx, ctx, "session.update", {
      sessionId: id,
      gameId: current.gameId,
      name: current.gameName,
      changes: set,
    });
    return getSession(scope, id);
  });
}

interface SessionTimeChanges {
  playedOn?: string;
  minutes?: number;
  startedAt?: string;
  endedAt?: string;
}

function manualSessionChanges(
  current: PlaySessionItem,
  patch: UpdateSessionInput,
): SessionTimeChanges {
  if (patch.startTime !== undefined || patch.endTime !== undefined) {
    throw new ValidationError(
      `A sessão ${current.id} foi registrada manualmente e não tem horário de início/fim`,
    );
  }
  return {
    ...(patch.playedOn !== undefined && { playedOn: patch.playedOn }),
    ...(patch.minutes !== undefined && { minutes: patch.minutes }),
  };
}

/**
 * Sessão de timer: dia + horário de início definem o começo; o fim vem do horário de fim
 * (antes do início = dia seguinte), da duração informada ou mantém a duração atual.
 */
function timerSessionChanges(
  ctx: ServiceContext,
  current: PlaySessionItem,
  patch: UpdateSessionInput,
): SessionTimeChanges {
  const startedAt = new Date(current.startedAt as string);
  const day = patch.playedOn ?? current.playedOn;
  const startTime = patch.startTime ?? zonedParts(startedAt, ctx.timeZone).time;
  const start = zonedToInstant(day, startTime, ctx.timeZone);

  let end: Date;
  if (patch.endTime) end = nextOccurrence(start, patch.endTime, ctx.timeZone);
  else if (patch.minutes) end = new Date(start.getTime() + patch.minutes * 60_000);
  else end = new Date(start.getTime() + current.minutes * 60_000);

  assertNotAfterNow(end, ctx.now);
  return {
    playedOn: day,
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    minutes: sessionMinutes(start, end),
  };
}

export function deleteSession(ctx: ServiceContext, id: number): PlaySessionItem {
  const session = getSession(ctx, id);
  ctx.db.transaction((tx) => {
    tx.delete(playSessions)
      .where(and(eq(playSessions.id, id), eq(playSessions.userId, ctx.userId)))
      .run();
    logActivity(tx, ctx, "session.delete", { ...session });
  });
  return session;
}

// ---------------------------------------------------------------------------
// Regras (também usadas pelo timer)

/**
 * Efeitos de uma sessão na entrada da biblioteca:
 * - jogar algo em Próximos/Desejos/Pausado move para Jogando (só com `resume`, o padrão);
 * - uma sessão antes do "começou em" (ou sem início registrado) puxa o início para o dia dela,
 *   desde que não passe da data de término (replay de um jogo zerado não mexe no início).
 * Retorna o novo status, se mudou.
 */
export function applySessionToEntry(
  { db, userId }: UserScope,
  entry: LibraryEntryRef,
  playedOn: string,
  { resume = true }: { resume?: boolean } = {},
): GameStatus | null {
  const status = resume && RESUMES_PLAYING.has(entry.status) ? "playing" : null;
  const pullsStart =
    (entry.startedAt === null || playedOn < entry.startedAt) &&
    (entry.finishedAt === null || playedOn <= entry.finishedAt);
  if (!status && !pullsStart) return null;
  db.update(libraryEntries)
    .set({ ...(status && { status }), ...(pullsStart && { startedAt: playedOn }) })
    .where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.gameId, entry.gameId)))
    .run();
  return status;
}

/** Duração em minutos inteiros; valida 1min a 24h. */
export function sessionMinutes(start: Date, end: Date): number {
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (minutes < 1) throw new ValidationError("A sessão precisa ter pelo menos 1 minuto");
  if (minutes > MAX_MINUTES_PER_DAY) {
    throw new ValidationError("Uma sessão vai até 24h: ajuste o horário de fim");
  }
  return minutes;
}

/** Tolerância de 1 minuto para diferença de relógio. */
export function assertNotAfterNow(instant: Date, now: Date) {
  if (instant.getTime() > now.getTime() + 60_000) {
    throw new ValidationError("O fim da sessão não pode ser no futuro");
  }
}

function assertNotFuture(playedOn: string, today: string) {
  if (playedOn > today) throw new ValidationError("A data da sessão não pode ser no futuro");
}

/** Um dia tem 24h: evita erros como registrar horas no lugar de minutos. */
export function assertDayCapacity(
  scope: UserScope,
  playedOn: string,
  minutes: number,
  excludeId?: number,
) {
  const total = minutesOnDay(scope, playedOn, excludeId) + minutes;
  if (total > MAX_MINUTES_PER_DAY) {
    throw new ValidationError(
      `Isso daria ${Math.round(total / 6) / 10}h jogadas em ${playedOn}, mais que 24h no dia`,
    );
  }
}

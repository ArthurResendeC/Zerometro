import { and, desc, eq, gte, lte, ne, type SQL, sql } from "drizzle-orm";
import type { GameStatus, SessionSource } from "../../shared/domain";
import {
  type ListSessionsQuery,
  type LogSessionInput,
  type LogSessionResult,
  MAX_MINUTES_PER_DAY,
  type PlaySessionItem,
  type UpdateSessionInput,
} from "../../shared/sessions";
import type { Db, DbOrTx } from "../db/client";
import { games, libraryEntries, playSessions } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { logActivity } from "./activity";
import type { ServiceContext } from "./context";

/** Registrar uma sessão desses status indica que voltei a jogar. */
const RESUMES_PLAYING: ReadonlySet<GameStatus> = new Set(["backlog", "wishlist", "paused"]);

// ---------------------------------------------------------------------------
// Leitura

export function listSessions(db: Db, query: ListSessionsQuery = {}): PlaySessionItem[] {
  const filters: SQL[] = [];
  if (query.gameId) filters.push(eq(playSessions.gameId, query.gameId));
  if (query.from) filters.push(gte(playSessions.playedOn, query.from));
  if (query.to) filters.push(lte(playSessions.playedOn, query.to));

  return selectSessions(db)
    .where(and(...filters))
    .orderBy(desc(playSessions.playedOn), desc(playSessions.id))
    .limit(query.limit ?? 100)
    .all();
}

export function getSession(db: DbOrTx, id: number): PlaySessionItem {
  const session = selectSessions(db).where(eq(playSessions.id, id)).get();
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
      minutes: playSessions.minutes,
      note: playSessions.note,
      source: playSessions.source,
      createdAt: playSessions.createdAt,
      updatedAt: playSessions.updatedAt,
    })
    .from(playSessions)
    .innerJoin(games, eq(games.id, playSessions.gameId));
}

/** Minutos jogados num dia (todos os jogos), opcionalmente ignorando uma sessão. */
export function minutesOnDay(db: DbOrTx, playedOn: string, excludeSessionId?: number): number {
  const filters = [eq(playSessions.playedOn, playedOn)];
  if (excludeSessionId) filters.push(ne(playSessions.id, excludeSessionId));
  return (
    db
      .select({ total: sql<number>`coalesce(sum(${playSessions.minutes}), 0)` })
      .from(playSessions)
      .where(and(...filters))
      .get()?.total ?? 0
  );
}

function minutesOnGame(db: DbOrTx, gameId: number): number {
  return (
    db
      .select({ total: sql<number>`coalesce(sum(${playSessions.minutes}), 0)` })
      .from(playSessions)
      .where(eq(playSessions.gameId, gameId))
      .get()?.total ?? 0
  );
}

// ---------------------------------------------------------------------------
// Escrita

export function logSession(
  ctx: ServiceContext,
  input: LogSessionInput,
  options: { source?: SessionSource } = {},
): LogSessionResult {
  const playedOn = input.playedOn ?? ctx.today;
  const source = options.source ?? (ctx.actor === "mcp" ? "mcp" : "manual");
  assertNotFuture(playedOn, ctx.today);

  const entry = ctx.db
    .select({
      name: games.name,
      status: libraryEntries.status,
      startedAt: libraryEntries.startedAt,
    })
    .from(libraryEntries)
    .innerJoin(games, eq(games.id, libraryEntries.gameId))
    .where(eq(libraryEntries.gameId, input.gameId))
    .get();
  if (!entry) throw new NotFoundError(`Jogo ${input.gameId} não está na biblioteca`);

  return ctx.db.transaction((tx) => {
    assertDayCapacity(tx, playedOn, input.minutes);

    const { id } = tx
      .insert(playSessions)
      .values({
        gameId: input.gameId,
        playedOn,
        minutes: input.minutes,
        note: input.note || null,
        source,
      })
      .returning({ id: playSessions.id })
      .get();

    let statusChangedTo: GameStatus | null = null;
    if (RESUMES_PLAYING.has(entry.status)) {
      statusChangedTo = "playing";
      tx.update(libraryEntries)
        .set({ status: "playing", startedAt: entry.startedAt ?? playedOn })
        .where(eq(libraryEntries.gameId, input.gameId))
        .run();
    }

    logActivity(tx, ctx.actor, "session.log", {
      sessionId: id,
      gameId: input.gameId,
      name: entry.name,
      playedOn,
      minutes: input.minutes,
      ...(statusChangedTo && { statusChangedTo }),
    });

    return {
      session: getSession(tx, id),
      dayTotalMinutes: minutesOnDay(tx, playedOn),
      gameTotalMinutes: minutesOnGame(tx, input.gameId),
      statusChangedTo,
    };
  });
}

export function updateSession(
  ctx: ServiceContext,
  id: number,
  patch: UpdateSessionInput,
): PlaySessionItem {
  const current = getSession(ctx.db, id);
  const playedOn = patch.playedOn ?? current.playedOn;
  const minutes = patch.minutes ?? current.minutes;
  assertNotFuture(playedOn, ctx.today);

  return ctx.db.transaction((tx) => {
    assertDayCapacity(tx, playedOn, minutes, id);
    const changes = {
      ...(patch.playedOn !== undefined && { playedOn: patch.playedOn }),
      ...(patch.minutes !== undefined && { minutes: patch.minutes }),
      ...(patch.note !== undefined && { note: patch.note || null }),
    };
    tx.update(playSessions).set(changes).where(eq(playSessions.id, id)).run();
    logActivity(tx, ctx.actor, "session.update", {
      sessionId: id,
      gameId: current.gameId,
      name: current.gameName,
      changes,
    });
    return getSession(tx, id);
  });
}

export function deleteSession(ctx: ServiceContext, id: number): PlaySessionItem {
  const session = getSession(ctx.db, id);
  ctx.db.transaction((tx) => {
    tx.delete(playSessions).where(eq(playSessions.id, id)).run();
    logActivity(tx, ctx.actor, "session.delete", { ...session });
  });
  return session;
}

// ---------------------------------------------------------------------------
// Regras

function assertNotFuture(playedOn: string, today: string) {
  if (playedOn > today) throw new ValidationError("A data da sessão não pode ser no futuro");
}

/** Um dia tem 24h: evita erros como registrar horas no lugar de minutos. */
function assertDayCapacity(db: DbOrTx, playedOn: string, minutes: number, excludeId?: number) {
  const total = minutesOnDay(db, playedOn, excludeId) + minutes;
  if (total > MAX_MINUTES_PER_DAY) {
    throw new ValidationError(
      `Isso daria ${Math.round(total / 6) / 10}h jogadas em ${playedOn}, mais que 24h no dia`,
    );
  }
}

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { zonedParts } from "../../shared/dates";
import type {
  ActiveSession,
  StartTimerInput,
  StartTimerResult,
  StopTimerInput,
  StopTimerResult,
  TimerState,
} from "../../shared/timer";
import { games, playSessions } from "../db/schema";
import { NotFoundError, TimerActiveError } from "../errors";
import { logActivity } from "./activity";
import type { ServiceContext, UserScope } from "./context";
import {
  assertDayCapacity,
  assertNotAfterNow,
  findLibraryEntry,
  getSession,
  minutesOnDay,
  minutesOnGame,
  nextOccurrence,
  resumePlaying,
  sessionMinutes,
} from "./sessions";

// Timer de sessão: uma linha em play_sessions com início e sem fim (no máximo uma, garantido
// por índice único parcial). Vive no servidor, então fechar a aba ou trocar de aparelho não perde nada.

export function getActiveSession({ db, userId }: UserScope): ActiveSession | null {
  return (
    (db
      .select({
        id: playSessions.id,
        gameId: playSessions.gameId,
        gameName: games.name,
        coverImageId: games.coverImageId,
        playedOn: playSessions.playedOn,
        startedAt: playSessions.startedAt,
        note: playSessions.note,
      })
      .from(playSessions)
      .innerJoin(games, eq(games.id, playSessions.gameId))
      .where(
        and(
          eq(playSessions.userId, userId),
          isNotNull(playSessions.startedAt),
          isNull(playSessions.endedAt),
        ),
      )
      .get() as ActiveSession | undefined) ?? null
  );
}

export function getTimerState(ctx: ServiceContext): TimerState {
  return { active: getActiveSession(ctx), now: ctx.now.toISOString() };
}

/**
 * "Comecei a jogar". Se o mesmo jogo já está rodando, não faz nada; se outro está,
 * só troca com `replaceActive` (senão 409 `timer_active`, para o cliente perguntar).
 */
export function startTimer(ctx: ServiceContext, input: StartTimerInput): StartTimerResult {
  const entry = findLibraryEntry(ctx, input.gameId);
  const current = getActiveSession(ctx);

  if (current?.gameId === input.gameId) {
    return { active: current, alreadyRunning: true, stopped: null, statusChangedTo: null };
  }
  if (current && !input.replaceActive) {
    const since = zonedParts(new Date(current.startedAt), ctx.timeZone).time;
    throw new TimerActiveError(`Você já está jogando ${current.gameName} desde ${since}`);
  }

  // Código síncrono (bun:sqlite): nenhuma outra requisição entra entre parar e começar.
  const stopped = current ? stopTimer(ctx, {}) : null;

  return ctx.db.transaction((tx) => {
    const scope = { db: tx, userId: ctx.userId };
    const { id } = tx
      .insert(playSessions)
      .values({
        userId: ctx.userId,
        gameId: input.gameId,
        playedOn: ctx.today,
        startedAt: ctx.now.toISOString(),
        source: "timer",
      })
      .returning({ id: playSessions.id })
      .get();

    const statusChangedTo = resumePlaying(scope, entry, ctx.today);
    logActivity(tx, ctx, "timer.start", {
      sessionId: id,
      gameId: input.gameId,
      name: entry.name,
      ...(statusChangedTo && { statusChangedTo }),
    });

    const active = getActiveSession(scope);
    if (!active) throw new Error("timer recém-criado não encontrado");
    return { active, alreadyRunning: false, stopped, statusChangedTo };
  });
}

/**
 * "Parei". Fecha a sessão no dia em que começou; menos de 1 minuto é descartado
 * (clique sem querer). `endTime` corrige o fim quando o timer ficou ligado sem querer.
 */
export function stopTimer(ctx: ServiceContext, input: StopTimerInput): StopTimerResult {
  const active = requireActive(ctx);
  const start = new Date(active.startedAt);
  const end = input.endTime ? nextOccurrence(start, input.endTime, ctx.timeZone) : ctx.now;
  assertNotAfterNow(end, ctx.now);

  if (!input.endTime && end.getTime() - start.getTime() < 60_000) {
    ctx.db.transaction((tx) => {
      tx.delete(playSessions).where(eq(playSessions.id, active.id)).run();
      logActivity(tx, ctx, "timer.discard", { sessionId: active.id, name: active.gameName });
    });
    return { discarded: true, gameName: active.gameName };
  }

  const minutes = sessionMinutes(start, end);
  return ctx.db.transaction((tx) => {
    const scope = { db: tx, userId: ctx.userId };
    assertDayCapacity(scope, active.playedOn, minutes, active.id);
    tx.update(playSessions)
      .set({
        endedAt: end.toISOString(),
        minutes,
        ...(input.note !== undefined && { note: input.note || null }),
      })
      .where(eq(playSessions.id, active.id))
      .run();
    logActivity(tx, ctx, "timer.stop", {
      sessionId: active.id,
      gameId: active.gameId,
      name: active.gameName,
      playedOn: active.playedOn,
      minutes,
    });
    return {
      discarded: false,
      session: getSession(scope, active.id),
      dayTotalMinutes: minutesOnDay(scope, active.playedOn),
      gameTotalMinutes: minutesOnGame(scope, active.gameId),
      statusChangedTo: null,
    };
  });
}

/** Descarta o timer rodando sem registrar nada. */
export function cancelTimer(ctx: ServiceContext): ActiveSession {
  const active = requireActive(ctx);
  ctx.db.transaction((tx) => {
    tx.delete(playSessions).where(eq(playSessions.id, active.id)).run();
    logActivity(tx, ctx, "timer.cancel", { sessionId: active.id, name: active.gameName });
  });
  return active;
}

function requireActive(scope: UserScope): ActiveSession {
  const active = getActiveSession(scope);
  if (!active) throw new NotFoundError("Nenhum timer rodando");
  return active;
}

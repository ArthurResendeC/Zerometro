import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { zonedParts } from "../../shared/dates";
import type {
  ActiveSession,
  StartTimerInput,
  StartTimerResult,
  StopTimerInput,
  StopTimerResult,
  TimerState,
  TimerTarget,
} from "../../shared/timer";
import { games, playSessions } from "../db/schema";
import { NotFoundError, TimerActiveError } from "../errors";
import { logActivity } from "./activity";
import type { ServiceContext, UserScope } from "./context";
import {
  applySessionToEntry,
  assertDayCapacity,
  assertNotAfterNow,
  findLibraryEntry,
  findSessionIdByClientId,
  getSession,
  minutesOnDay,
  minutesOnGame,
  nextOccurrence,
  savedSessionResult,
  sessionMinutes,
} from "./sessions";
import { currentStreak } from "./stats";

// Timer de sessão: uma linha em play_sessions com início e sem fim (no máximo uma, garantido
// por índice único parcial). Vive no servidor, então fechar a aba ou trocar de aparelho não perde nada.

export function getActiveSession({ db, userId }: UserScope): ActiveSession | null {
  return (
    (db
      .select({
        id: playSessions.id,
        gameId: playSessions.gameId,
        igdbId: games.igdbId,
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
 * `startedAt` (fila offline) começa no passado: o dia da sessão é o desse instante, e a troca
 * de jogo encerra o anterior nele.
 */
export function startTimer(ctx: ServiceContext, input: StartTimerInput): StartTimerResult {
  const entry = findLibraryEntry(ctx, input.gameId);
  const current = getActiveSession(ctx);

  // Reenvio da fila offline: o start já chegou (e talvez já tenha até parado).
  const existingId = input.clientId && findSessionIdByClientId(ctx, input.clientId);
  if (existingId) {
    return {
      active: current?.id === existingId ? current : null,
      alreadyRunning: true,
      alreadySaved: true,
      stopped: null,
      statusChangedTo: null,
    };
  }

  const startedAt = input.startedAt ? new Date(input.startedAt) : ctx.now;
  if (input.startedAt) assertNotAfterNow(startedAt, ctx.now);

  if (current?.gameId === input.gameId) {
    // O timer rodando passa a responder pelo clientId deste start (o stop offline aponta para ele).
    if (input.clientId) adoptClientId(ctx, current.id, input.clientId);
    return { active: current, alreadyRunning: true, stopped: null, statusChangedTo: null };
  }
  if (current && !input.replaceActive) {
    const since = zonedParts(new Date(current.startedAt), ctx.timeZone).time;
    throw new TimerActiveError(`Você já está jogando ${current.gameName} desde ${since}`);
  }
  if (current && startedAt.getTime() < Date.parse(current.startedAt)) {
    const since = zonedParts(new Date(current.startedAt), ctx.timeZone).time;
    throw new TimerActiveError(
      `${current.gameName} começou às ${since}, depois deste início: pare ou descarte ele antes`,
    );
  }

  // Código síncrono (bun:sqlite): nenhuma outra requisição entra entre parar e começar.
  const stopped = current
    ? stopTimer(ctx, input.startedAt ? { endedAt: startedAt.toISOString() } : {})
    : null;
  const playedOn = zonedParts(startedAt, ctx.timeZone).date;

  return ctx.db.transaction((tx) => {
    const scope = { db: tx, userId: ctx.userId };
    const { id } = tx
      .insert(playSessions)
      .values({
        userId: ctx.userId,
        gameId: input.gameId,
        playedOn,
        startedAt: startedAt.toISOString(),
        source: "timer",
        clientId: input.clientId ?? null,
      })
      .returning({ id: playSessions.id })
      .get();

    const statusChangedTo = applySessionToEntry(scope, entry, playedOn);
    logActivity(tx, ctx, "timer.start", {
      sessionId: id,
      gameId: input.gameId,
      name: entry.name,
      ...(input.startedAt && { startedAt: input.startedAt }),
      ...(statusChangedTo && { statusChangedTo }),
    });

    const active = getActiveSession(scope);
    if (!active) throw new Error("timer recém-criado não encontrado");
    return { active, alreadyRunning: false, stopped, statusChangedTo };
  });
}

function adoptClientId({ db, userId }: UserScope, id: number, clientId: string) {
  db.update(playSessions)
    .set({ clientId })
    .where(
      and(eq(playSessions.id, id), eq(playSessions.userId, userId), isNull(playSessions.clientId)),
    )
    .run();
}

/**
 * "Parei". Fecha a sessão no dia em que começou; menos de 1 minuto é descartado
 * (clique sem querer). `endTime` corrige o fim quando o timer ficou ligado sem querer.
 */
export function stopTimer(ctx: ServiceContext, input: StopTimerInput): StopTimerResult {
  if (input.target) {
    const id = resolveTarget(ctx, input.target);
    // Já parado (em outro aparelho, ou reenvio da fila): devolve o que ficou gravado.
    if (getActiveSession(ctx)?.id !== id)
      return { discarded: false, ...savedSessionResult(ctx, id) };
  }
  const active = requireActive(ctx);
  const start = new Date(active.startedAt);
  const end = input.endedAt
    ? new Date(input.endedAt)
    : input.endTime
      ? nextOccurrence(start, input.endTime, ctx.timeZone)
      : ctx.now;
  assertNotAfterNow(end, ctx.now);

  if (!input.endTime && end.getTime() - start.getTime() < 60_000) {
    ctx.db.transaction((tx) => {
      tx.delete(playSessions).where(eq(playSessions.id, active.id)).run();
      logActivity(tx, ctx, "timer.discard", { sessionId: active.id, name: active.gameName });
    });
    return { discarded: true, gameName: active.gameName };
  }

  const minutes = sessionMinutes(start, end);
  const streakBefore = currentStreak(ctx, ctx.today);
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
      streak: { before: streakBefore, current: currentStreak(scope, ctx.today) },
    };
  });
}

/** Descarta o timer rodando sem registrar nada. Com alvo, só se for ele que está rodando. */
export function cancelTimer(ctx: ServiceContext, target?: TimerTarget): ActiveSession {
  const active = requireActive(ctx);
  if (target && resolveTarget(ctx, target) !== active.id) {
    throw new NotFoundError("Esse timer não está mais rodando");
  }
  ctx.db.transaction((tx) => {
    tx.delete(playSessions).where(eq(playSessions.id, active.id)).run();
    logActivity(tx, ctx, "timer.cancel", { sessionId: active.id, name: active.gameName });
  });
  return active;
}

/** Id da sessão apontada (do usuário); 404 se não existe mais (descartada ou apagada). */
function resolveTarget(scope: UserScope, target: TimerTarget): number {
  const id =
    "id" in target
      ? getSessionRow(scope, target.id)
      : findSessionIdByClientId(scope, target.clientId);
  if (!id) throw new NotFoundError("Timer não encontrado: foi descartado ou apagado");
  return id;
}

function getSessionRow({ db, userId }: UserScope, id: number) {
  return db
    .select({ id: playSessions.id })
    .from(playSessions)
    .where(and(eq(playSessions.id, id), eq(playSessions.userId, userId)))
    .get()?.id;
}

function requireActive(scope: UserScope): ActiveSession {
  const active = getActiveSession(scope);
  if (!active) throw new NotFoundError("Nenhum timer rodando");
  return active;
}

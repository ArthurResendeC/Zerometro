import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { addDays, todayIn } from "../../shared/dates";
import { MAX_MINUTES_PER_DAY } from "../../shared/sessions";
import type { DbOrTx } from "../db/client";
import { games, libraryEntries, playSessions } from "../db/schema";
import type { ServiceContext } from "./context";
import { applySessionToEntry, minutesOnDay } from "./sessions";
import { placeSteamChunk } from "./steam-session-chunks";

// Horas da Steam viram sessões. A Steam só manda o total de cada jogo (sem histórico por dia),
// então o que já estava lá na primeira sincronização fica como "antes do Zerômetro" e, daí em
// diante, a diferença entre duas sincronizações vira uma sessão `steam`. Assim o tempo jogado
// pela Steam entra na ofensiva, no heatmap, nas estatísticas e nos objetivos.
//
// A base (`steam_counted_minutes`/`_at`) é o total da Steam já contado. Regras:
// - sem base: só marca (primeira sincronização, ou perfil novo);
// - total menor que a base (tempo escondido na Steam, reembolso): ignora;
// - timer rodando no jogo: espera (o tempo dele entraria duas vezes);
// - jogo que usa as sessões como fonte do tempo: a base avança sem criar sessão;
// - o timer e os registros manuais do jogo desde a base são descontados (são mais precisos);
// - sincronizações seguidas viram uma sessão só, com início e fim aproximados (regras em
//   `steam-session-chunks.ts`);
// - base antiga (mais de 3h: servidor fora do ar) ou sem espaço no dia: a sessão vai para o dia
//   em que jogou por último (se a Steam mandar e for depois da base) ou para hoje, sem horário, e
//   o que não couber em 24h volta para os dias anteriores, até o dia da base.

/** Até aqui desde a base, dá para estimar o início e o fim do que foi jogado. */
export const STEAM_TIMED_WINDOW_MS = 3 * 60 * 60_000;

export interface SteamPlaytimeSessions {
  /** Minutos que viraram sessão nesta sincronização. */
  minutes: number;
  /** Dias das sessões criadas (mais recente primeiro). */
  days: string[];
}

const none: SteamPlaytimeSessions = { minutes: 0, days: [] };

/**
 * Compara o total da Steam com a base e cria as sessões do que foi jogado desde então. Roda na
 * transação da sincronização; `game` é o jogo na conta agora.
 */
export function countSteamPlaytime(
  tx: DbOrTx,
  ctx: ServiceContext,
  gameId: number,
  game: { minutes: number; lastPlayedAt: Date | null },
): SteamPlaytimeSessions {
  const scope = { db: tx, userId: ctx.userId };
  const where = and(eq(libraryEntries.userId, ctx.userId), eq(libraryEntries.gameId, gameId));
  const entry = tx
    .select({
      gameId: libraryEntries.gameId,
      name: games.name,
      status: libraryEntries.status,
      startedAt: libraryEntries.startedAt,
      finishedAt: libraryEntries.finishedAt,
      playtimeSource: libraryEntries.playtimeSource,
      countedMinutes: libraryEntries.steamCountedMinutes,
      countedAt: libraryEntries.steamCountedAt,
    })
    .from(libraryEntries)
    .innerJoin(games, eq(games.id, libraryEntries.gameId))
    .where(where)
    .get();
  if (!entry) return none;

  const now = ctx.now.toISOString();
  const advance = () =>
    tx
      .update(libraryEntries)
      .set({ steamCountedMinutes: game.minutes, steamCountedAt: now })
      .where(where)
      .run();

  if (entry.countedMinutes === null || entry.countedAt === null) {
    advance();
    return none;
  }
  const { countedAt } = entry;
  if (timerRunningOn(tx, ctx.userId, gameId)) return none;
  const delta = game.minutes - entry.countedMinutes;
  // O total caiu: tempo de jogo escondido na Steam (tudo 0) ou reembolso. A base fica onde está,
  // senão voltar a mostrar o tempo viraria uma sessão enorme.
  if (delta < 0) return none;
  // Sem mudança: a base avança no tempo (o que for registrado depois não é descontado à toa).
  if (delta === 0 || entry.playtimeSource !== "steam") {
    advance();
    return none;
  }

  const logged =
    tx
      .select({ total: sql<number>`coalesce(sum(${playSessions.minutes}), 0)` })
      .from(playSessions)
      .where(
        and(
          eq(playSessions.userId, ctx.userId),
          eq(playSessions.gameId, gameId),
          ne(playSessions.source, "steam"),
          isNotNull(playSessions.minutes),
          sql`coalesce(${playSessions.endedAt}, ${playSessions.createdAt}) > ${countedAt}`,
        ),
      )
      .get()?.total ?? 0;
  advance();
  let remaining = delta - logged;
  if (remaining <= 0) return none;

  const timed = placeTimed(tx, ctx, entry, remaining);
  if (timed) return timed;

  const floor = todayIn(ctx.timeZone, new Date(countedAt));
  const playedAt =
    game.lastPlayedAt && game.lastPlayedAt.toISOString() > countedAt ? game.lastPlayedAt : ctx.now;
  let day = todayIn(ctx.timeZone, playedAt);
  if (day > ctx.today) day = ctx.today;
  const result: SteamPlaytimeSessions = { minutes: 0, days: [] };
  while (remaining > 0 && day >= floor) {
    const minutes = Math.min(remaining, MAX_MINUTES_PER_DAY - minutesOnDay(scope, day));
    if (minutes > 0) {
      tx.insert(playSessions)
        .values({ userId: ctx.userId, gameId, playedOn: day, minutes, source: "steam" })
        .run();
      applySessionToEntry(scope, entry, day);
      result.minutes += minutes;
      result.days.push(day);
      remaining -= minutes;
    }
    day = addDays(day, -1);
  }
  return result;
}

type SteamEntry = Parameters<typeof applySessionToEntry>[1] & {
  gameId: number;
  countedAt: string | null;
};

/** Estende a sessão da sincronização anterior ou cria uma com horário; null = caminho sem horário. */
function placeTimed(
  tx: DbOrTx,
  ctx: ServiceContext,
  entry: SteamEntry,
  minutes: number,
): SteamPlaytimeSessions | null {
  const from = new Date(entry.countedAt as string);
  if (ctx.now.getTime() - from.getTime() > STEAM_TIMED_WINDOW_MS) return null;
  const scope = { db: tx, userId: ctx.userId };
  const previous = tx
    .select({
      id: playSessions.id,
      playedOn: playSessions.playedOn,
      minutes: playSessions.minutes,
      endedAt: playSessions.endedAt,
    })
    .from(playSessions)
    .where(
      and(
        eq(playSessions.userId, ctx.userId),
        eq(playSessions.gameId, entry.gameId),
        eq(playSessions.source, "steam"),
        isNotNull(playSessions.endedAt),
      ),
    )
    .orderBy(desc(playSessions.endedAt))
    .get();
  const placement = placeSteamChunk(
    { minutes, from, to: ctx.now },
    previous
      ? { minutes: previous.minutes ?? 0, endedAt: new Date(previous.endedAt as string) }
      : null,
  );
  const day =
    placement.extend && previous ? previous.playedOn : todayIn(ctx.timeZone, placement.startedAt);
  if (minutes > MAX_MINUTES_PER_DAY - minutesOnDay(scope, day)) return null;

  const times = {
    minutes: placement.minutes,
    startedAt: placement.startedAt.toISOString(),
    endedAt: placement.endedAt.toISOString(),
  };
  if (placement.extend && previous) {
    tx.update(playSessions).set(times).where(eq(playSessions.id, previous.id)).run();
  } else {
    tx.insert(playSessions)
      .values({
        userId: ctx.userId,
        gameId: entry.gameId,
        playedOn: day,
        source: "steam",
        ...times,
      })
      .run();
    applySessionToEntry(scope, entry, day);
  }
  return { minutes, days: [day] };
}

function timerRunningOn(db: DbOrTx, userId: string, gameId: number): boolean {
  return Boolean(
    db
      .select({ id: playSessions.id })
      .from(playSessions)
      .where(
        and(
          eq(playSessions.userId, userId),
          eq(playSessions.gameId, gameId),
          isNull(playSessions.minutes),
        ),
      )
      .get(),
  );
}

/** Perfil da Steam trocado: as horas da outra conta não servem de base. */
export function resetSteamBaselines(db: DbOrTx, userId: string): void {
  db.update(libraryEntries)
    .set({ steamCountedMinutes: null, steamCountedAt: null })
    .where(eq(libraryEntries.userId, userId))
    .run();
}

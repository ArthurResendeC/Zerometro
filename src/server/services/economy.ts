import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { todayIn } from "../../shared/dates";
import {
  achievementCoins,
  type CoinEntry,
  type CoinEntryDetails,
  type CoinReason,
  derivedReasons,
  playtimeCoins,
  WALLET_PAGE_SIZE,
  type Wallet,
} from "../../shared/economy";
import {
  achievementSets,
  achievementUnlocks,
  achievements,
  coinLedger,
  games,
  playSessions,
  user,
  userAchievementSets,
} from "../db/schema";
import { NotFoundError } from "../errors";
import type { ServiceContext, UserScope } from "./context";

// Carteira de moedas. O saldo é a soma do livro-razão (`coin_ledger`, só inserção). Os ganhos de
// horas e de conquistas são derivados dos dados: `reconcileWallet` calcula quanto cada origem
// (um dia jogado, uma conquista) deveria valer e lança a diferença. Assim editar ou apagar uma
// sessão vira um ajuste, e mudar uma regra em shared/economy.ts se acerta sozinho.

/** Desde quando rende: o cadastro do perfil (instante e dia no fuso do usuário). */
export function earningsSince(scope: UserScope, timeZone: string): { at: Date; day: string } {
  const row = scope.db
    .select({ createdAt: user.createdAt })
    .from(user)
    .where(eq(user.id, scope.userId))
    .get();
  if (!row) throw new NotFoundError("Perfil não encontrado");
  return { at: row.createdAt, day: todayIn(timeZone, row.createdAt) };
}

interface Expected {
  reason: CoinReason;
  refKey: string;
  amount: number;
  details: CoinEntryDetails;
}

/** O que cada origem deveria valer hoje, pelas regras atuais. */
function expectedEarnings(ctx: ServiceContext): Expected[] {
  const since = earningsSince(ctx, ctx.timeZone);
  const expected: Expected[] = [];

  // Horas: por dia jogado desde o cadastro (o timer rodando ainda não conta).
  const days = ctx.db
    .select({
      day: playSessions.playedOn,
      minutes: sql<number>`sum(${playSessions.minutes})`.mapWith(Number),
    })
    .from(playSessions)
    .where(
      and(
        eq(playSessions.userId, ctx.userId),
        isNotNull(playSessions.minutes),
        gte(playSessions.playedOn, since.day),
      ),
    )
    .groupBy(playSessions.playedOn)
    .all();
  for (const { day, minutes } of days) {
    expected.push({
      reason: "playtime",
      refKey: `day:${day}`,
      amount: playtimeCoins(minutes),
      details: { day, minutes },
    });
  }

  // Conquistas: só da Steam, vindas da sincronização, desbloqueadas depois do cadastro.
  const unlocked = ctx.db
    .selectDistinct({
      achievementId: achievements.id,
      title: achievements.title,
      rarity: achievements.rarity,
      game: games.name,
    })
    .from(achievementUnlocks)
    .innerJoin(achievements, eq(achievements.id, achievementUnlocks.achievementId))
    .innerJoin(achievementSets, eq(achievementSets.id, achievements.setId))
    .leftJoin(
      userAchievementSets,
      and(
        eq(userAchievementSets.setId, achievementSets.id),
        eq(userAchievementSets.userId, ctx.userId),
      ),
    )
    .leftJoin(games, eq(games.id, userAchievementSets.gameId))
    .where(
      and(
        eq(achievementUnlocks.userId, ctx.userId),
        eq(achievementUnlocks.origin, "sync"),
        eq(achievementSets.source, "steam"),
        gte(achievementUnlocks.unlockedAt, since.at.toISOString()),
      ),
    )
    .all();
  const seen = new Set<number>();
  for (const a of unlocked) {
    if (seen.has(a.achievementId)) continue; // a mesma lista ligada a dois jogos conta uma vez
    seen.add(a.achievementId);
    expected.push({
      reason: "achievement",
      refKey: `achievement:${a.achievementId}`,
      amount: achievementCoins(a.rarity),
      details: { title: a.title, game: a.game, rarity: a.rarity },
    });
  }
  return expected;
}

/**
 * Acerta o livro-razão com os dados: lança o que falta (ganhos novos) e o que sobra (sessão
 * apagada, conquista que saiu) como ajuste. Idempotente: rodar de novo sem mudança não lança nada.
 * Devolve quanto entrou (ou saiu) agora.
 */
export function reconcileWallet(ctx: ServiceContext): number {
  return ctx.db.transaction((tx) => {
    const current = new Map<string, { amount: number; reason: CoinReason }>();
    const rows = tx
      .select({
        reason: coinLedger.reason,
        refKey: coinLedger.refKey,
        amount: sql<number>`sum(${coinLedger.amount})`.mapWith(Number),
      })
      .from(coinLedger)
      .where(and(eq(coinLedger.userId, ctx.userId), inArray(coinLedger.reason, derivedReasons)))
      .groupBy(coinLedger.reason, coinLedger.refKey)
      .all();
    for (const row of rows) current.set(`${row.reason}|${row.refKey}`, row);

    const inserts: (typeof coinLedger.$inferInsert)[] = [];
    const createdAt = ctx.now.toISOString();
    for (const item of expectedEarnings(ctx)) {
      const key = `${item.reason}|${item.refKey}`;
      const had = current.get(key)?.amount ?? 0;
      current.delete(key);
      const diff = item.amount - had;
      if (diff === 0) continue;
      inserts.push({
        userId: ctx.userId,
        amount: diff,
        reason: item.reason,
        refKey: item.refKey,
        details: had === 0 ? item.details : { ...item.details, adjustment: true },
        createdAt,
      });
    }
    // O que estava no livro e não existe mais (sessões do dia apagadas, conquista desmarcada).
    for (const [key, { amount, reason }] of current) {
      if (amount === 0) continue;
      const refKey = key.slice(reason.length + 1);
      inserts.push({
        userId: ctx.userId,
        amount: -amount,
        reason,
        refKey,
        details: {
          adjustment: true,
          ...(refKey.startsWith("day:") && { day: refKey.slice(4), minutes: 0 }),
        },
        createdAt,
      });
    }
    if (inserts.length > 0) tx.insert(coinLedger).values(inserts).run();
    return inserts.reduce((sum, row) => sum + row.amount, 0);
  });
}

/** Saldo, totais por origem e os lançamentos mais recentes (acertando o livro antes). */
export function getWallet(ctx: ServiceContext): Wallet {
  reconcileWallet(ctx);
  const totals = ctx.db
    .select({
      reason: coinLedger.reason,
      amount: sql<number>`sum(${coinLedger.amount})`.mapWith(Number),
    })
    .from(coinLedger)
    .where(eq(coinLedger.userId, ctx.userId))
    .groupBy(coinLedger.reason)
    .all();
  const byReason = new Map(totals.map((t) => [t.reason, t.amount]));
  const entries: CoinEntry[] = ctx.db
    .select({
      id: coinLedger.id,
      amount: coinLedger.amount,
      reason: coinLedger.reason,
      details: coinLedger.details,
      createdAt: coinLedger.createdAt,
    })
    .from(coinLedger)
    .where(eq(coinLedger.userId, ctx.userId))
    .orderBy(desc(coinLedger.createdAt), desc(coinLedger.id))
    .limit(WALLET_PAGE_SIZE)
    .all();
  return {
    balance: totals.reduce((sum, t) => sum + t.amount, 0),
    earned: {
      playtime: byReason.get("playtime") ?? 0,
      achievement: byReason.get("achievement") ?? 0,
    },
    since: earningsSince(ctx, ctx.timeZone).day,
    entries,
  };
}

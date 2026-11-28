import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  achievementUnlocks,
  achievements,
  coinLedger,
  games,
  playSessions,
  user,
  userAchievementSets,
} from "../db/schema";
import { createTestContext, createTestUser, fakeRaSet, fakeSteamSet } from "../testing";
import type { ServiceContext } from "./context";
import { saveSet } from "./achievement-catalog";
import { getWallet, reconcileWallet } from "./economy";

// O dono "se cadastrou" em 10/11 (meio-dia em São Paulo); o "agora" dos testes é 19/11.
const SIGNUP = new Date("2026-11-10T15:00:00.000Z");

function setup(ctx: ServiceContext = createTestContext()) {
  ctx.db.update(user).set({ createdAt: SIGNUP }).where(eq(user.id, ctx.userId)).run();
  const game = ctx.db
    .insert(games)
    .values({ igdbId: 1, name: "Persona 5 Royal", slug: "persona-5-royal" })
    .returning()
    .get();
  return { ctx, gameId: game.id };
}

function session(ctx: ServiceContext, gameId: number, playedOn: string, minutes: number | null) {
  return ctx.db
    .insert(playSessions)
    .values({
      userId: ctx.userId,
      gameId,
      playedOn,
      minutes,
      source: minutes === null ? "timer" : "manual",
      ...(minutes === null && { startedAt: ctx.now.toISOString() }),
    })
    .returning()
    .get();
}

function ledger(ctx: ServiceContext) {
  return ctx.db
    .select({
      amount: coinLedger.amount,
      reason: coinLedger.reason,
      refKey: coinLedger.refKey,
      details: coinLedger.details,
    })
    .from(coinLedger)
    .where(eq(coinLedger.userId, ctx.userId))
    .orderBy(coinLedger.id)
    .all();
}

describe("horas jogadas", () => {
  test("só dias desde o cadastro, somando o dia; o timer rodando não conta", () => {
    const { ctx, gameId } = setup();
    session(ctx, gameId, "2026-11-09", 120); // antes do cadastro
    session(ctx, gameId, "2026-11-10", 90); // dia do cadastro: conta
    session(ctx, gameId, "2026-11-12", 30);
    session(ctx, gameId, "2026-11-12", 45);
    session(ctx, gameId, "2026-11-19", null); // timer rodando

    expect(reconcileWallet(ctx)).toBe(15 + 12);
    expect(ledger(ctx)).toEqual([
      {
        amount: 15,
        reason: "playtime",
        refKey: "day:2026-11-10",
        details: { day: "2026-11-10", minutes: 90 },
      },
      {
        amount: 12,
        reason: "playtime",
        refKey: "day:2026-11-12",
        details: { day: "2026-11-12", minutes: 75 },
      },
    ]);
  });

  test("teto de 6h por dia", () => {
    const { ctx, gameId } = setup();
    session(ctx, gameId, "2026-11-15", 500);
    expect(reconcileWallet(ctx)).toBe(60);
  });

  test("recalcular sem mudança não lança nada", () => {
    const { ctx, gameId } = setup();
    session(ctx, gameId, "2026-11-15", 60);
    reconcileWallet(ctx);
    expect(reconcileWallet(ctx)).toBe(0);
    expect(ledger(ctx)).toHaveLength(1);
  });

  test("editar ou apagar sessão vira ajuste, sem apagar o histórico", () => {
    const { ctx, gameId } = setup();
    const a = session(ctx, gameId, "2026-11-15", 120);
    reconcileWallet(ctx);

    ctx.db.update(playSessions).set({ minutes: 60 }).where(eq(playSessions.id, a.id)).run();
    expect(reconcileWallet(ctx)).toBe(-10);

    ctx.db.delete(playSessions).where(eq(playSessions.id, a.id)).run();
    expect(reconcileWallet(ctx)).toBe(-10);

    expect(ledger(ctx).map((e) => [e.amount, e.details])).toEqual([
      [20, { day: "2026-11-15", minutes: 120 }],
      [-10, { day: "2026-11-15", minutes: 60, adjustment: true }],
      [-10, { day: "2026-11-15", minutes: 0, adjustment: true }],
    ]);
    expect(getWallet(ctx).balance).toBe(0);
  });
});

function linkSteamSet(ctx: ServiceContext, gameId: number, fetched = fakeSteamSet()) {
  const set = saveSet(ctx.db, fetched, ctx.now);
  ctx.db.insert(userAchievementSets).values({ userId: ctx.userId, gameId, setId: set.id }).run();
  const list = ctx.db
    .select()
    .from(achievements)
    .where(eq(achievements.setId, set.id))
    .orderBy(achievements.sortOrder)
    .all();
  return { id: set.id, achievements: list };
}

function unlock(
  ctx: ServiceContext,
  achievementId: number,
  unlockedAt: string,
  origin: "sync" | "manual" = "sync",
) {
  ctx.db
    .insert(achievementUnlocks)
    .values({ userId: ctx.userId, achievementId, unlockedAt, origin })
    .run();
}

describe("conquistas", () => {
  test("Steam sincronizada depois do cadastro, pela raridade", () => {
    const { ctx, gameId } = setup();
    const set = linkSteamSet(ctx, gameId);
    const [common, rare, ultra] = set.achievements; // 80%, 30%, 8%
    unlock(ctx, common!.id, "2026-11-12T20:00:00.000Z");
    unlock(ctx, rare!.id, "2026-11-13T20:00:00.000Z");
    unlock(ctx, ultra!.id, "2026-11-14T20:00:00.000Z");

    expect(reconcileWallet(ctx)).toBe(5 + 10 + 30);
    expect(ledger(ctx).at(-1)).toEqual({
      amount: 30,
      reason: "achievement",
      refKey: `achievement:${ultra!.id}`,
      details: { title: "Final verdadeiro", game: "Persona 5 Royal", rarity: 8 },
    });
  });

  test("não rendem: antes do cadastro, marcadas à mão, e as do RetroAchievements", () => {
    const { ctx, gameId } = setup();
    const steam = linkSteamSet(ctx, gameId);
    unlock(ctx, steam.achievements[0]!.id, "2026-11-01T20:00:00.000Z"); // antes do cadastro
    unlock(ctx, steam.achievements[1]!.id, "2026-11-12T20:00:00.000Z", "manual");
    const ra = linkSteamSet(ctx, gameId, fakeRaSet());
    unlock(ctx, ra.achievements[0]!.id, "2026-11-12T20:00:00.000Z");

    expect(reconcileWallet(ctx)).toBe(0);
    expect(ledger(ctx)).toEqual([]);
  });

  test("a mesma lista em dois jogos conta uma vez", () => {
    const { ctx, gameId } = setup();
    const set = linkSteamSet(ctx, gameId);
    const other = ctx.db
      .insert(games)
      .values({ igdbId: 2, name: "Outro", slug: "outro" })
      .returning()
      .get();
    ctx.db
      .insert(userAchievementSets)
      .values({ userId: ctx.userId, gameId: other.id, setId: set.id })
      .run();
    unlock(ctx, set.achievements[0]!.id, "2026-11-12T20:00:00.000Z");
    expect(reconcileWallet(ctx)).toBe(5);
  });
});

describe("carteira", () => {
  test("saldo, totais por origem, desde quando e lançamentos do mais novo ao mais velho", () => {
    const { ctx, gameId } = setup();
    session(ctx, gameId, "2026-11-12", 60);
    reconcileWallet(ctx);
    session(ctx, gameId, "2026-11-13", 120);
    const later = { ...ctx, now: new Date("2026-11-19T19:00:00.000Z") };

    const wallet = getWallet(later);
    expect(wallet).toMatchObject({
      balance: 30,
      earned: { playtime: 30, achievement: 0 },
      since: "2026-11-10",
    });
    expect(wallet.entries.map((e) => e.amount)).toEqual([20, 10]);
  });

  test("cada perfil tem a sua", () => {
    const { ctx, gameId } = setup();
    session(ctx, gameId, "2026-11-12", 60);
    const friend = { ...ctx, userId: createTestUser(ctx.db, "amigo") };
    expect(getWallet(friend).balance).toBe(0);
    expect(getWallet(ctx).balance).toBe(10);
  });
});

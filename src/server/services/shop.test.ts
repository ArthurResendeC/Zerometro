import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { coinLedger, games, playSessions, user } from "../db/schema";
import { ConflictError, InsufficientCoinsError } from "../errors";
import { createTestContext } from "../testing";
import type { ServiceContext } from "./context";
import { getWallet } from "./economy";
import { ownsItem } from "./items";
import { getShop, purchaseItem } from "./shop";

const SIGNUP = new Date("2026-11-01T15:00:00.000Z");

/** Perfil com `hours` horas jogadas em dias diferentes desde o cadastro (6h por dia, o teto). */
function withCoins(hours: number): ServiceContext {
  const ctx = createTestContext();
  ctx.db.update(user).set({ createdAt: SIGNUP }).where(eq(user.id, ctx.userId)).run();
  const game = ctx.db
    .insert(games)
    .values({ igdbId: 1, name: "Persona 5 Royal", slug: "persona-5-royal" })
    .returning()
    .get();
  let left = hours * 60;
  for (let day = 2; left > 0; day++) {
    const minutes = Math.min(left, 360);
    ctx.db
      .insert(playSessions)
      .values({
        userId: ctx.userId,
        gameId: game.id,
        playedOn: `2026-11-${String(day).padStart(2, "0")}`,
        minutes,
        source: "manual",
      })
      .run();
    left -= minutes;
  }
  return ctx;
}

describe("vitrine", () => {
  test("temas e pacotes à venda com preço e posse; o grátis só aparece porque é de todos", () => {
    const shop = getShop(withCoins(0));
    expect(shop.balance).toBe(0);
    expect(shop.items.map((i) => [i.kind, i.id, i.price, i.owned])).toEqual([
      ["theme", "cartucho", null, true],
      ["theme", "minimal", 250, false],
      ["theme", "ladrao-fantasma", 400, false],
      ["sound_pack", "cartucho", null, true],
      ["sound_pack", "minimal", 80, false],
      ["sound_pack", "ladrao-fantasma", 80, false],
    ]);
  });
});

describe("compra", () => {
  test("debita, dá o tema e o pacote de som dele, numa transação", () => {
    const ctx = withCoins(30); // 300 moedas
    const shop = purchaseItem(ctx, { kind: "theme", itemId: "minimal" });
    expect(shop.balance).toBe(50);
    expect(ownsItem(ctx, "theme", "minimal")).toBe(true);
    expect(ownsItem(ctx, "sound_pack", "minimal")).toBe(true);
    expect(shop.items.find((i) => i.id === "minimal" && i.kind === "theme")?.owned).toBe(true);
    expect(getWallet(ctx).entries[0]).toMatchObject({
      amount: -250,
      reason: "purchase",
      details: { title: "Minimal" },
    });
  });

  test("saldo insuficiente não debita nem dá nada", () => {
    const ctx = withCoins(20); // 200 moedas
    expect(() => purchaseItem(ctx, { kind: "theme", itemId: "minimal" })).toThrow(
      new InsufficientCoinsError(250, 200),
    );
    expect(ownsItem(ctx, "theme", "minimal")).toBe(false);
    expect(ctx.db.select().from(coinLedger).where(eq(coinLedger.reason, "purchase")).all()).toEqual(
      [],
    );
  });

  test("não compra o que já tem (nem o pacote que veio com o tema)", () => {
    const ctx = withCoins(40);
    purchaseItem(ctx, { kind: "theme", itemId: "minimal" });
    expect(() => purchaseItem(ctx, { kind: "theme", itemId: "minimal" })).toThrow(ConflictError);
    expect(() => purchaseItem(ctx, { kind: "sound_pack", itemId: "minimal" })).toThrow(
      "Você já tem Toques do Minimal",
    );
    expect(getWallet(ctx).balance).toBe(150);
  });

  test("o que não está à venda", () => {
    const ctx = withCoins(40);
    expect(() => purchaseItem(ctx, { kind: "theme", itemId: "cartucho" })).toThrow(
      "Cartucho não está à venda",
    );
  });

  test("pacote de som avulso", () => {
    const ctx = withCoins(10);
    expect(purchaseItem(ctx, { kind: "sound_pack", itemId: "ladrao-fantasma" }).balance).toBe(20);
    expect(ownsItem(ctx, "sound_pack", "ladrao-fantasma")).toBe(true);
    expect(ownsItem(ctx, "theme", "ladrao-fantasma")).toBe(false);
  });
});

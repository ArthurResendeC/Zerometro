import { eq, sql } from "drizzle-orm";
import {
  itemName,
  type PurchaseInput,
  priceOf,
  type Shop,
  type ShopItem,
  soundPackIds,
  soundPacks,
} from "../../shared/items";
import { themeIds, themes } from "../../shared/themes";
import { coinLedger } from "../db/schema";
import { ConflictError, InsufficientCoinsError } from "../errors";
import type { ServiceContext, UserScope } from "./context";
import { reconcileWallet } from "./economy";
import { grantItemIn, ownedIds } from "./items";

// Loja: vitrine de temas e pacotes de som, e a compra (débito no livro-razão + posse, numa
// transação só). Os preços ficam em shared/items.ts.

function balanceOf({ db, userId }: UserScope): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${coinLedger.amount}), 0)`.mapWith(Number) })
    .from(coinLedger)
    .where(eq(coinLedger.userId, userId))
    .get();
  return row?.total ?? 0;
}

/** A vitrine: o que está à venda, mais o que o perfil já tem (mesmo se não estiver à venda). */
export function getShop(ctx: ServiceContext): Shop {
  reconcileWallet(ctx);
  const ownedThemes = ownedIds(ctx, "theme");
  const ownedPacks = ownedIds(ctx, "sound_pack");
  const items: ShopItem[] = [
    ...themeIds.map((id) => ({
      kind: "theme" as const,
      id,
      name: themes[id].name,
      description: themes[id].description,
      price: priceOf("theme", id),
      owned: ownedThemes.has(id),
    })),
    ...soundPackIds.map((id) => ({
      kind: "sound_pack" as const,
      id,
      name: soundPacks[id].name,
      description: soundPacks[id].description,
      price: priceOf("sound_pack", id),
      owned: ownedPacks.has(id),
    })),
  ].filter((item) => item.price !== null || item.owned);
  return { balance: balanceOf(ctx), items };
}

/**
 * Compra um item: confere que está à venda, que o perfil ainda não tem e que o saldo dá, e então
 * debita e concede (com o pacote de som, se for tema) na mesma transação.
 */
export function purchaseItem(ctx: ServiceContext, input: PurchaseInput): Shop {
  const name = itemName(input.kind, input.itemId);
  const price = priceOf(input.kind, input.itemId);
  if (price === null) throw new ConflictError(`${name} não está à venda`);
  // Saldo em dia com as sessões e conquistas antes de decidir.
  reconcileWallet(ctx);

  ctx.db.transaction((tx) => {
    const scope = { db: tx, userId: ctx.userId };
    if (ownedIds(scope, input.kind).has(input.itemId)) {
      throw new ConflictError(`Você já tem ${name}`);
    }
    const balance = balanceOf(scope);
    if (balance < price) throw new InsufficientCoinsError(price, balance);
    tx.insert(coinLedger)
      .values({
        userId: ctx.userId,
        amount: -price,
        reason: "purchase",
        refKey: `${input.kind}:${input.itemId}`,
        details: { title: name },
        createdAt: ctx.now.toISOString(),
      })
      .run();
    grantItemIn(tx, ctx, ctx.userId, input, "purchase");
  });
  return getShop(ctx);
}

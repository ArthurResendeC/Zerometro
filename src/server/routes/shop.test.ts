import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { Shop } from "../../shared/items";
import type { LibraryItem } from "../../shared/library";
import { user } from "../db/schema";
import { createTestApp } from "../testing";

function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

describe("/api/shop", () => {
  test("vitrine, saldo insuficiente, compra e uso do tema comprado", async () => {
    const { request, db, userId, clock } = await createTestApp();
    db.update(user)
      .set({ createdAt: new Date(clock.now().getTime() - 60 * 86_400_000) })
      .where(eq(user.id, userId))
      .run();

    const shop = (await (await request("/api/shop")).json()) as Shop;
    expect(shop.balance).toBe(0);
    expect(shop.items.filter((i) => i.price !== null)).toHaveLength(4);

    const poor = await request("/api/shop/purchase", json({ kind: "theme", itemId: "minimal" }));
    expect(poor.status).toBe(409);
    expect(await poor.json()).toMatchObject({ error: { code: "insufficient_coins" } });

    // 5 dias de 6h = 300 moedas
    const res = await request("/api/library", json({ igdbId: 114283, status: "backlog" }));
    const { item } = (await res.json()) as { item: LibraryItem };
    const today = new Date(clock.now());
    for (let i = 1; i <= 5; i++) {
      const day = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      // oxlint-disable-next-line no-await-in-loop
      await request("/api/sessions", json({ gameId: item.gameId, minutes: 360, playedOn: day }));
    }

    const bought = await request("/api/shop/purchase", json({ kind: "theme", itemId: "minimal" }));
    expect(bought.status).toBe(201);
    expect(((await bought.json()) as Shop).balance).toBe(50);

    const settings = await request("/api/settings", json({ themeId: "minimal" }, "PATCH"));
    expect(settings.status).toBe(200);

    const unknown = await request("/api/shop/purchase", json({ kind: "theme", itemId: "nada" }));
    expect(unknown.status).toBe(400);
  });
});

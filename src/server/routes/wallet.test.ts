import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { Wallet } from "../../shared/economy";
import type { LibraryItem } from "../../shared/library";
import { user } from "../db/schema";
import { createTestApp } from "../testing";

function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

describe("/api/wallet", () => {
  test("sessões registradas rendem moedas; apagar vira ajuste", async () => {
    const { request, db, userId, clock } = await createTestApp();
    // Cadastro uma semana antes do "agora" dos testes.
    db.update(user)
      .set({ createdAt: new Date(clock.now().getTime() - 7 * 86_400_000) })
      .where(eq(user.id, userId))
      .run();
    const wallet = async () => (await (await request("/api/wallet")).json()) as Wallet;
    expect(await wallet()).toMatchObject({ balance: 0, entries: [] });

    const res = await request("/api/library", json({ igdbId: 114283, status: "backlog" }));
    const { item } = (await res.json()) as { item: LibraryItem };
    const created = await request("/api/sessions", json({ gameId: item.gameId, minutes: 90 }));
    const { session } = (await created.json()) as { session: { id: number } };

    expect(await wallet()).toMatchObject({
      balance: 15,
      earned: { playtime: 15, achievement: 0 },
      entries: [{ amount: 15, reason: "playtime", details: { minutes: 90 } }],
    });

    await request(`/api/sessions/${session.id}`, { method: "DELETE" });
    const after = await wallet();
    expect(after.balance).toBe(0);
    expect(after.entries.map((e) => e.amount)).toEqual([-15, 15]);
  });

  test("cada perfil vê só a sua carteira", async () => {
    const { createMember } = await createTestApp();
    const joao = await createMember("joao");
    const res = await joao.request("/api/wallet");
    expect(res.status).toBe(200);
    expect(((await res.json()) as Wallet).balance).toBe(0);
  });
});

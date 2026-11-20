import { describe, expect, test } from "bun:test";
import type { AchievementCandidates, GameAchievements } from "../../shared/achievements";
import type { LibraryItem } from "../../shared/library";
import { createDisabledSteamApi } from "../services/steam";
import { createTestApp } from "../testing";

function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

describe("/api/library/:gameId/achievements", () => {
  test("sugerir, ligar, listar, atualizar e desligar uma lista", async () => {
    const { request } = await createTestApp();
    const created = await request("/api/library", json({ igdbId: 114283, status: "playing" }));
    const { item } = (await created.json()) as { item: LibraryItem };
    const base = `/api/library/${item.gameId}/achievements`;

    const candidates = (await (
      await request(`${base}/candidates`)
    ).json()) as AchievementCandidates;
    expect(candidates.candidates.map((c) => [c.source, c.externalId])).toEqual([
      ["steam", "1687950"],
    ]);

    const linked = await request(`${base}/sets`, json({ source: "steam", id: "1687950" }));
    expect(linked.status).toBe(201);
    const { sets } = (await linked.json()) as GameAchievements;
    expect(sets[0]?.total).toBe(3);

    const listed = (await (await request(base)).json()) as GameAchievements;
    expect(listed.summary).toMatchObject({ total: 3, unlocked: 0 });

    expect((await request(`${base}/refresh`, { method: "POST" })).status).toBe(200);

    const unlinked = await request(`${base}/sets/${sets[0]!.id}`, { method: "DELETE" });
    expect(((await unlinked.json()) as GameAchievements).sets).toEqual([]);
  });

  test("id inválido → 400; fonte sem chave → 503", async () => {
    const { request } = await createTestApp({ steam: createDisabledSteamApi() });
    const created = await request("/api/library", json({ igdbId: 114283, status: "playing" }));
    const { item } = (await created.json()) as { item: LibraryItem };
    const base = `/api/library/${item.gameId}/achievements`;

    const invalid = await request(`${base}/sets`, json({ source: "steam", id: "celeste" }));
    expect(invalid.status).toBe(400);
    const off = await request(`${base}/sets`, json({ source: "steam", id: "1687950" }));
    expect(off.status).toBe(503);
  });
});

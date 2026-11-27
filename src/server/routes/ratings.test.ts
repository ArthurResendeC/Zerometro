import { describe, expect, test } from "bun:test";
import type { LibraryItem } from "../../shared/library";
import type { RatingItem, RatingTemplate } from "../../shared/ratings";
import { createTestApp } from "../testing";

function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

const scores = {
  controls: 6,
  goals: 5,
  feedback: 6,
  challenge: 5,
  audiovisual: 7,
  technical: 6,
  mastery: 5,
  curiosity: 7,
  immersion: 7,
  autonomy: 4,
  meaning: 6,
  narrative: 7,
  social: null,
};

describe("/api/.../ratings", () => {
  test("avaliar, listar, reavaliar e apagar; a nota da biblioteca acompanha", async () => {
    const { request } = await createTestApp();
    await request("/api/library", json({ igdbId: 114283, status: "finished" }));

    const created = await request("/api/library/1/ratings", json({ scores, enjoyment: 9 }));
    expect(created.status).toBe(201);
    const { rating, item } = (await created.json()) as { rating: RatingItem; item: LibraryItem };
    expect(rating).toMatchObject({ gameId: 1, enjoyment: 9, mode: "blend", applicableCount: 12 });
    expect(rating.weighted).toBeGreaterThan(7);
    expect(item.rating).toBeCloseTo(rating.final);

    const list = (await (await request("/api/library/1/ratings")).json()) as {
      ratings: RatingItem[];
    };
    expect(list.ratings.map((r) => r.id)).toEqual([rating.id]);

    const patched = await request(`/api/ratings/${rating.id}`, json({ mode: "gut" }, "PATCH"));
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { item: LibraryItem }).item.rating).toBe(9);

    const removed = await request(`/api/ratings/${rating.id}`, { method: "DELETE" });
    expect(((await removed.json()) as { item: LibraryItem }).item.rating).toBeNull();
    expect((await request(`/api/ratings/${rating.id}`, { method: "DELETE" })).status).toBe(404);
  });

  test("validação: notas fora de 1–7, coração fora de 0–10 ou fora do passo de 0,5", async () => {
    const { request } = await createTestApp();
    await request("/api/library", json({ igdbId: 114283, status: "finished" }));
    const post = (body: unknown) => request("/api/library/1/ratings", json(body));

    expect((await post({ scores: { controls: 8 }, enjoyment: 9 })).status).toBe(400);
    expect((await post({ scores: { controls: 0 }, enjoyment: 9 })).status).toBe(400);
    expect((await post({ enjoyment: 11 })).status).toBe(400);
    expect((await post({ enjoyment: 7.3 })).status).toBe(400);
    expect((await post({ enjoyment: 7.5 })).status).toBe(201);
    expect((await request("/api/ratings/1", json({}, "PATCH"))).status).toBe(400);
    expect((await request("/api/library/99/ratings", json({ enjoyment: 5 }))).status).toBe(404);
  });

  test("template: preset sugerido e calibragem", async () => {
    const { request } = await createTestApp();
    await request("/api/library", json({ igdbId: 114283, status: "finished" }));

    const res = await request("/api/ratings/template?gameId=1");
    expect(res.status).toBe(200);
    const { template } = (await res.json()) as { template: RatingTemplate };
    expect(template).toMatchObject({ suggestedPreset: "rpg", mode: "blend", latest: null });
    expect(template.calibration.controls).toEqual([]);
    expect((await request("/api/ratings/template")).status).toBe(200);
  });

  test("ajustes da avaliação pelo /api/settings", async () => {
    const { request } = await createTestApp();
    const res = await request(
      "/api/settings",
      json({ ratingMode: "weighted", ratingBlendWeight: 0.6 }, "PATCH"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      settings: { ratingMode: "weighted", ratingBlendWeight: 0.6, ratingCustomWeights: null },
    });
    expect((await request("/api/settings", json({ ratingBlendWeight: 1 }, "PATCH"))).status).toBe(
      400,
    );
  });
});

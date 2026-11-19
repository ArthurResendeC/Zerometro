import { describe, expect, test } from "bun:test";
import type { LibraryItem, StatusCounts } from "../../shared/library";
import { createTestApp } from "../testing";

function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

describe("/api/library", () => {
  test("fluxo completo: adicionar, listar, atualizar e remover", async () => {
    const { app } = createTestApp();

    const created = await app.request("/api/library", json({ igdbId: 114283, status: "playing" }));
    expect(created.status).toBe(201);
    const { item } = (await created.json()) as { item: LibraryItem };
    expect(item).toMatchObject({ name: "Persona 5 Royal", status: "playing" });

    const list = await app.request("/api/library?status=playing");
    const listBody = (await list.json()) as { items: LibraryItem[]; counts: StatusCounts };
    expect(listBody.items).toHaveLength(1);
    expect(listBody.counts.playing).toBe(1);

    const patched = await app.request(
      `/api/library/${item.gameId}`,
      json({ status: "finished", rating: 10 }, "PATCH"),
    );
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { item: LibraryItem }).item).toMatchObject({
      status: "finished",
      rating: 10,
    });

    const removed = await app.request(`/api/library/${item.gameId}`, { method: "DELETE" });
    expect(await removed.json()).toMatchObject({ removed: { name: "Persona 5 Royal" } });

    const missing = await app.request(`/api/library/${item.gameId}`);
    expect(missing.status).toBe(404);
  });

  test("duplicado → 409", async () => {
    const { app } = createTestApp();
    await app.request("/api/library", json({ igdbId: 114283, status: "backlog" }));

    const res = await app.request("/api/library", json({ igdbId: 114283, status: "playing" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "conflict" } });
  });

  test("valida corpo e parâmetros", async () => {
    const { app } = createTestApp();

    const badStatus = await app.request("/api/library", json({ igdbId: 1, status: "zerado" }));
    const badRating = await app.request("/api/library/1", json({ rating: 11 }, "PATCH"));
    const emptyPatch = await app.request("/api/library/1", json({}, "PATCH"));
    const badId = await app.request("/api/library/abc");

    for (const res of [badStatus, badRating, emptyPatch, badId]) {
      expect(res.status).toBe(400);
    }
  });

  test("data no futuro → 400 com mensagem", async () => {
    const { app } = createTestApp();
    const created = await app.request("/api/library", json({ igdbId: 114283, status: "playing" }));
    const { item } = (await created.json()) as { item: LibraryItem };

    const res = await app.request(
      `/api/library/${item.gameId}`,
      json({ status: "finished", finishedAt: "2030-01-01" }, "PATCH"),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { message: "A data de término não pode ser no futuro" },
    });
  });

  test("jogo inexistente no IGDB → 404", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/library", json({ igdbId: 1, status: "backlog" }));
    expect(res.status).toBe(404);
  });
});

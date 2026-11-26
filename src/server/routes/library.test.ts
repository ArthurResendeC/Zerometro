import { describe, expect, test } from "bun:test";
import type { CompletionItem } from "../../shared/completions";
import type { LibraryItem, StatusCounts } from "../../shared/library";
import { createTestApp } from "../testing";

function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

describe("/api/library", () => {
  test("fluxo completo: adicionar, listar, atualizar e remover", async () => {
    const { request } = await createTestApp();

    const created = await request("/api/library", json({ igdbId: 114283, status: "playing" }));
    expect(created.status).toBe(201);
    const { item } = (await created.json()) as { item: LibraryItem };
    expect(item).toMatchObject({ name: "Persona 5 Royal", status: "playing" });

    const list = await request("/api/library?status=playing");
    const listBody = (await list.json()) as { items: LibraryItem[]; counts: StatusCounts };
    expect(listBody.items).toHaveLength(1);
    expect(listBody.counts.playing).toBe(1);

    const patched = await request(
      `/api/library/${item.gameId}`,
      json({ status: "finished", rating: 10 }, "PATCH"),
    );
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { item: LibraryItem }).item).toMatchObject({
      status: "finished",
      rating: 10,
    });

    const removed = await request(`/api/library/${item.gameId}`, { method: "DELETE" });
    expect(await removed.json()).toMatchObject({ removed: { name: "Persona 5 Royal" } });

    const missing = await request(`/api/library/${item.gameId}`);
    expect(missing.status).toBe(404);
  });

  test("busca pelo id do IGDB: item, null fora da biblioteca, só do próprio usuário", async () => {
    const { request } = await createTestApp();
    await request("/api/library", json({ igdbId: 114283, status: "backlog" }));

    const found = await request("/api/library/igdb/114283");
    expect(found.status).toBe(200);
    expect(((await found.json()) as { item: LibraryItem }).item).toMatchObject({
      igdbId: 114283,
      status: "backlog",
    });

    const missing = await request("/api/library/igdb/999");
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ item: null });

    expect((await request("/api/library/igdb/abc")).status).toBe(400);
  });

  test("duplicado → 409", async () => {
    const { request } = await createTestApp();
    await request("/api/library", json({ igdbId: 114283, status: "backlog" }));

    const res = await request("/api/library", json({ igdbId: 114283, status: "playing" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "conflict" } });
  });

  test("valida corpo e parâmetros", async () => {
    const { request } = await createTestApp();

    const badStatus = await request("/api/library", json({ igdbId: 1, status: "zerado" }));
    const badRating = await request("/api/library/1", json({ rating: 11 }, "PATCH"));
    const emptyPatch = await request("/api/library/1", json({}, "PATCH"));
    const badId = await request("/api/library/abc");

    for (const res of [badStatus, badRating, emptyPatch, badId]) {
      expect(res.status).toBe(400);
    }
  });

  test("data no futuro → 400 com mensagem", async () => {
    const { request } = await createTestApp();
    const created = await request("/api/library", json({ igdbId: 114283, status: "playing" }));
    const { item } = (await created.json()) as { item: LibraryItem };

    const res = await request(
      `/api/library/${item.gameId}`,
      json({ status: "finished", finishedAt: "2030-01-01" }, "PATCH"),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { message: "A data de término não pode ser no futuro" },
    });
  });

  test("jogo inexistente no IGDB → 404", async () => {
    const { request } = await createTestApp();
    const res = await request("/api/library", json({ igdbId: 1, status: "backlog" }));
    expect(res.status).toBe(404);
  });

  test("conclusões: marcar, listar, filtrar pós-jogo e apagar", async () => {
    const { request } = await createTestApp();
    const created = await request("/api/library", json({ igdbId: 114283, status: "playing" }));
    const { item } = (await created.json()) as { item: LibraryItem };
    const base = `/api/library/${item.gameId}/completions`;

    const marked = await request(base, json({ type: "main", date: "2026-11-01" }));
    expect(marked.status).toBe(201);
    const body = (await marked.json()) as { completion: CompletionItem; item: LibraryItem };
    expect(body.item).toMatchObject({ displayState: "postgame", completion: { best: "main" } });

    const listed = await request(base);
    expect(await listed.json()).toMatchObject({ completions: [{ completedOn: "2026-11-01" }] });

    const postgame = await request("/api/library?displayState=postgame");
    expect(await postgame.json()).toMatchObject({ items: [{ gameId: item.gameId }], postgame: 1 });

    expect((await request(base, json({ type: "platina" }))).status).toBe(400);
    expect((await request(base, json({ type: "main", date: "2030-01-01" }))).status).toBe(400);

    const removed = await request(`/api/completions/${body.completion.id}`, { method: "DELETE" });
    expect(await removed.json()).toMatchObject({ item: { completion: null } });
  });

  test("onde parei: anota a última sessão e aparece no item", async () => {
    const { request } = await createTestApp();
    await request("/api/library", json({ igdbId: 114283, status: "playing" }));

    const noSession = await request("/api/library/1/last-note", json({ note: "x" }, "PUT"));
    expect(noSession.status).toBe(404);

    await request("/api/sessions", json({ gameId: 1, minutes: 30 }));
    const noted = await request("/api/library/1/last-note", json({ note: " Palácio 3 " }, "PUT"));
    expect(noted.status).toBe(200);
    const { item } = (await (await request("/api/library/1")).json()) as { item: LibraryItem };
    expect(item.lastNote).toMatchObject({ note: "Palácio 3" });
  });
});

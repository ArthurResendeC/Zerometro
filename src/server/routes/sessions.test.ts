import { describe, expect, test } from "bun:test";
import type { LibraryItem } from "../../shared/library";
import type { LogSessionResult, PlaySessionItem } from "../../shared/sessions";
import { createTestApp } from "../testing";

function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function setup() {
  const { request } = await createTestApp();
  const res = await request("/api/library", json({ igdbId: 114283, status: "backlog" }));
  const { item } = (await res.json()) as { item: LibraryItem };
  return { request, gameId: item.gameId };
}

describe("/api/sessions", () => {
  test("registrar, listar, editar e apagar", async () => {
    const { request, gameId } = await setup();

    const created = await request("/api/sessions", json({ gameId, minutes: 90 }));
    expect(created.status).toBe(201);
    const result = (await created.json()) as LogSessionResult;
    expect(result).toMatchObject({ dayTotalMinutes: 90, statusChangedTo: "playing" });

    const list = await request(`/api/sessions?gameId=${gameId}`);
    const { sessions } = (await list.json()) as { sessions: PlaySessionItem[] };
    expect(sessions).toHaveLength(1);

    const patched = await request(
      `/api/sessions/${result.session.id}`,
      json({ minutes: 120 }, "PATCH"),
    );
    expect(((await patched.json()) as { session: PlaySessionItem }).session.minutes).toBe(120);

    const deleted = await request(`/api/sessions/${result.session.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
  });

  test("clientId repetido devolve 200 com a mesma sessão; clientId inválido é 400", async () => {
    const { request, gameId } = await setup();
    const body = { gameId, minutes: 30, clientId: "7c1e2b9a-3d4f-4a5b-8c6d-9e0f1a2b3c4d" };

    const first = await request("/api/sessions", json(body));
    const again = await request("/api/sessions", json(body));
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    const [a, b] = (await Promise.all([first.json(), again.json()])) as LogSessionResult[];
    expect(b!.session.id).toBe(a!.session.id);
    expect(b!.alreadySaved).toBe(true);

    const invalid = await request("/api/sessions", json({ ...body, clientId: "abc" }));
    expect(invalid.status).toBe(400);
  });

  test("valida minutos, data e corpo vazio", async () => {
    const { request, gameId } = await setup();

    const cases = [
      json({ gameId, minutes: 0 }),
      json({ gameId, minutes: 1.5 }),
      json({ gameId, minutes: 30, playedOn: "19/11/2026" }),
      json({ gameId, minutes: 30, playedOn: "2030-01-01" }),
    ];
    const responses = await Promise.all(cases.map((init) => request("/api/sessions", init)));
    expect(responses.map((r) => r.status)).toEqual([400, 400, 400, 400]);
    const emptyPatch = await request("/api/sessions/1", json({}, "PATCH"));
    expect(emptyPatch.status).toBe(400);
  });

  test("sessão inexistente → 404", async () => {
    const { request } = await setup();
    const res = await request("/api/sessions/999", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

import { describe, expect, test } from "bun:test";
import type { LibraryItem } from "../../shared/library";
import type { LogSessionResult, PlaySessionItem } from "../../shared/sessions";
import { createTestApp } from "../testing";

function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function setup() {
  const { app } = createTestApp();
  const res = await app.request("/api/library", json({ igdbId: 114283, status: "backlog" }));
  const { item } = (await res.json()) as { item: LibraryItem };
  return { app, gameId: item.gameId };
}

describe("/api/sessions", () => {
  test("registrar, listar, editar e apagar", async () => {
    const { app, gameId } = await setup();

    const created = await app.request("/api/sessions", json({ gameId, minutes: 90 }));
    expect(created.status).toBe(201);
    const result = (await created.json()) as LogSessionResult;
    expect(result).toMatchObject({ dayTotalMinutes: 90, statusChangedTo: "playing" });

    const list = await app.request(`/api/sessions?gameId=${gameId}`);
    const { sessions } = (await list.json()) as { sessions: PlaySessionItem[] };
    expect(sessions).toHaveLength(1);

    const patched = await app.request(
      `/api/sessions/${result.session.id}`,
      json({ minutes: 120 }, "PATCH"),
    );
    expect(((await patched.json()) as { session: PlaySessionItem }).session.minutes).toBe(120);

    const deleted = await app.request(`/api/sessions/${result.session.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
  });

  test("valida minutos, data e corpo vazio", async () => {
    const { app, gameId } = await setup();

    const cases = [
      json({ gameId, minutes: 0 }),
      json({ gameId, minutes: 1.5 }),
      json({ gameId, minutes: 30, playedOn: "19/11/2026" }),
      json({ gameId, minutes: 30, playedOn: "2030-01-01" }),
    ];
    const responses = await Promise.all(cases.map((init) => app.request("/api/sessions", init)));
    expect(responses.map((r) => r.status)).toEqual([400, 400, 400, 400]);
    const emptyPatch = await app.request("/api/sessions/1", json({}, "PATCH"));
    expect(emptyPatch.status).toBe(400);
  });

  test("sessão inexistente → 404", async () => {
    const { app } = await setup();
    const res = await app.request("/api/sessions/999", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

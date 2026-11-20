import { describe, expect, test } from "bun:test";
import type { LibraryItem } from "../../shared/library";
import type { ObjectiveItem, ObjectiveWriteResult } from "../../shared/objectives";
import { createTestApp } from "../testing";

function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

describe("/api/objectives", () => {
  test("criar, listar, incrementar, editar, reordenar e apagar", async () => {
    const { request, loginAs } = await createTestApp();
    const created = await request("/api/library", json({ igdbId: 114283, status: "playing" }));
    const { item } = (await created.json()) as { item: LibraryItem };
    const base = `/api/library/${item.gameId}/objectives`;

    const korok = await request(base, json({ title: "Sementes Korok", target: 900 }));
    expect(korok.status).toBe(201);
    const { objective } = (await korok.json()) as ObjectiveWriteResult;
    await request(base, json({ title: "Todos os santuários" }));

    const inc = await request(`/api/objectives/${objective.id}/increment`, json({ by: 10 }));
    expect(await inc.json()).toMatchObject({ objective: { progress: 10 } });
    const one = await request(`/api/objectives/${objective.id}/increment`, json({}));
    expect(await one.json()).toMatchObject({ objective: { progress: 11 } });

    const patched = await request(`/api/objectives/${objective.id}`, json({ target: 5 }, "PATCH"));
    expect(await patched.json()).toMatchObject({ objective: { progress: 5, target: 5 } });

    const listed = (await (await request(base)).json()) as { objectives: ObjectiveItem[] };
    const ids = listed.objectives.map((o) => o.id).toReversed();
    const reordered = await request(`${base}/order`, json({ ids }, "PUT"));
    expect(
      ((await reordered.json()) as { objectives: ObjectiveItem[] }).objectives.map((o) => o.id),
    ).toEqual(ids);

    const friend = await loginAs("amigo@zerometro.test");
    expect(
      (await friend.request(`/api/objectives/${objective.id}`, { method: "DELETE" })).status,
    ).toBe(404);

    const deleted = await request(`/api/objectives/${objective.id}`, { method: "DELETE" });
    expect(await deleted.json()).toMatchObject({ summary: { total: 1 } });
  });

  test("valida o corpo", async () => {
    const { request } = await createTestApp();
    const created = await request("/api/library", json({ igdbId: 114283, status: "playing" }));
    const { item } = (await created.json()) as { item: LibraryItem };
    const base = `/api/library/${item.gameId}/objectives`;

    const invalid = [{ title: "" }, { title: "A", target: 0 }, { title: "A", target: 1.5 }];
    const responses = await Promise.all(invalid.map((body) => request(base, json(body))));
    expect(responses.map((res) => res.status)).toEqual([400, 400, 400]);
    expect((await request("/api/objectives/1/increment", json({ by: 0 }))).status).toBe(400);
    expect((await request("/api/objectives/1", json({}, "PATCH"))).status).toBe(400);
  });
});

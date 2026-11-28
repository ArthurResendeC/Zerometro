import { describe, expect, test } from "bun:test";
import type { OwnedItem } from "../../shared/items";
import { createTestApp } from "../testing";

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body !== undefined && { body: JSON.stringify(body) }),
});

const items = async (res: Response) => ((await res.json()) as { items: OwnedItem[] }).items;

describe("itens e tema na conta", () => {
  test("o admin concede um tema; o perfil passa a ter e pode usar", async () => {
    const { request, createMember } = await createTestApp();
    const joao = await createMember("joao");

    expect((await items(await joao.request("/api/me/items"))).map((i) => i.itemId)).toEqual([
      "cartucho",
      "alto-contraste",
      "cartucho",
    ]);
    const refused = await joao.request("/api/settings", send("PATCH", { themeId: "minimal" }));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "item_not_owned" } });

    const granted = await request(
      `/api/admin/users/${joao.userId}/items`,
      send("POST", { kind: "theme", itemId: "minimal" }),
    );
    expect(granted.status).toBe(201);
    expect(await granted.json()).toEqual({ created: true });
    const again = await request(
      `/api/admin/users/${joao.userId}/items`,
      send("POST", { kind: "theme", itemId: "minimal" }),
    );
    expect(again.status).toBe(200);

    expect(await items(await joao.request("/api/me/items"))).toMatchObject([
      { kind: "theme", itemId: "cartucho" },
      { kind: "theme", itemId: "alto-contraste" },
      { kind: "sound_pack", itemId: "cartucho" },
      { kind: "theme", itemId: "minimal", source: "grant" },
      { kind: "sound_pack", itemId: "minimal", source: "grant" },
    ]);
    const res = await joao.request("/api/settings", send("PATCH", { themeId: "minimal" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ settings: { themeId: "minimal", soundPackId: null } });
  });

  test("só o admin concede, e só itens que existem", async () => {
    const { request, createMember } = await createTestApp();
    const joao = await createMember("joao");
    const bySelf = await joao.request(
      `/api/admin/users/${joao.userId}/items`,
      send("POST", { kind: "theme", itemId: "minimal" }),
    );
    expect(bySelf.status).toBe(403);
    const unknown = await request(
      `/api/admin/users/${joao.userId}/items`,
      send("POST", { kind: "theme", itemId: "tema-que-nao-existe" }),
    );
    expect(unknown.status).toBe(400);
    const nobody = await request(
      "/api/admin/users/ninguem/items",
      send("POST", { kind: "theme", itemId: "minimal" }),
    );
    expect(nobody.status).toBe(404);
  });
});

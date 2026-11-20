import { describe, expect, test } from "bun:test";
import type { IgdbGamePage } from "../../shared/game-page";
import { createFakeIgdb, createTestApp, fakeIgdbGame } from "../testing";

describe("/api/igdb/games/:igdbId", () => {
  test("devolve a página do jogo e quando foi buscada", async () => {
    const { request } = await createTestApp({
      igdb: createFakeIgdb([fakeIgdbGame({ igdbId: 119133, name: "Elden Ring" })]),
    });

    const res = await request("/api/igdb/games/119133");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { game: IgdbGamePage; updatedAt: string };
    expect(body.game).toMatchObject({ igdbId: 119133, name: "Elden Ring" });
    expect(typeof body.updatedAt).toBe("string");
  });

  test("jogo inexistente → 404; id inválido → 400", async () => {
    const { request } = await createTestApp();
    expect((await request("/api/igdb/games/999")).status).toBe(404);
    expect((await request("/api/igdb/games/abc")).status).toBe(400);
  });

  test("exige login", async () => {
    const { app } = await createTestApp();
    expect((await app.request("/api/igdb/games/1")).status).toBe(401);
  });
});

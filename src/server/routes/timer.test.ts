import { describe, expect, test } from "bun:test";
import type { ApiErrorBody } from "../errors";
import { createFakeIgdb, createTestApp, fakeIgdbGame } from "../testing";

function post(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("/api/timer", () => {
  test("começar, conflito com outro jogo, parar", async () => {
    const { request, clock } = await createTestApp();
    const added = await request("/api/library", post({ igdbId: 114283, status: "playing" }));
    const { item } = (await added.json()) as { item: { gameId: number } };

    expect(await (await request("/api/timer")).json()).toMatchObject({ active: null });

    const started = await request("/api/timer/start", post({ gameId: item.gameId }));
    expect(started.status).toBe(201);
    expect((await request("/api/timer/start", post({ gameId: item.gameId }))).status).toBe(200);

    const otherGame = await request("/api/timer/start", post({ gameId: 999 }));
    expect(otherGame.status).toBe(404);

    clock.set(new Date("2026-11-19T19:00:00Z"));
    const stopped = await request("/api/timer/stop", post({}));
    expect(await stopped.json()).toMatchObject({ discarded: false, session: { minutes: 60 } });

    const none = await request("/api/timer/stop", post({}));
    expect(none.status).toBe(404);
  });

  test("409 timer_active ao começar outro jogo", async () => {
    const { request } = await createTestApp({
      igdb: createFakeIgdb([fakeIgdbGame(), fakeIgdbGame({ igdbId: 12517, name: "Undertale" })]),
    });
    const add = async (igdbId: number) => {
      const res = await request("/api/library", post({ igdbId, status: "playing" }));
      return ((await res.json()) as { item: { gameId: number } }).item.gameId;
    };
    const persona = await add(114283);
    const undertale = await add(12517);

    await request("/api/timer/start", post({ gameId: persona }));
    const conflict = await request("/api/timer/start", post({ gameId: undertale }));
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as ApiErrorBody).error).toMatchObject({
      code: "timer_active",
      message: "Você já está jogando Persona 5 Royal desde 15:00",
    });

    const switched = await request(
      "/api/timer/start",
      post({ gameId: undertale, replaceActive: true }),
    );
    expect(await switched.json()).toMatchObject({
      active: { gameName: "Undertale" },
      stopped: { discarded: true }, // 0 minutos jogados no Persona
    });
  });

  test("endTime inválido → 400", async () => {
    const { request } = await createTestApp();
    const res = await request("/api/timer/stop", post({ endTime: "25:00" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe("invalid_input");
  });
});

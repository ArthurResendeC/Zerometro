import { describe, expect, test } from "bun:test";
import { createDisabledIgdbClient } from "./services/igdb/client";
import { createIgdbApi } from "./services/igdb";
import { createTestApp } from "./testing";

describe("GET /api/health", () => {
  test("responde ok", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });
});

describe("GET /api/igdb/search", () => {
  test("retorna os resultados da busca", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/igdb/search?q=persona");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { igdbId: number; name: string }[] };
    expect(body.results).toEqual([
      expect.objectContaining({ igdbId: 114283, name: "Persona 5 Royal" }),
    ]);
  });

  test("valida a query com o formato de erro padrão", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/igdb/search?q=a");

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_input" } });
  });

  test("sem credenciais do IGDB → 503", async () => {
    const { app } = createTestApp({ igdb: createIgdbApi(createDisabledIgdbClient()) });
    const res = await app.request("/api/igdb/search?q=persona");

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "igdb_not_configured" } });
  });
});

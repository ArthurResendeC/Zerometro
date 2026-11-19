import { describe, expect, test } from "bun:test";
import { createTestDb } from "../../db/client";
import { IgdbError } from "../../errors";
import {
  createIgdbClient,
  createKvTokenStore,
  createMemoryTokenStore,
  createThrottle,
  type StoredToken,
} from "./client";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-19T12:00:00Z");

type Handler = (url: string, init: RequestInit) => Response;

/** fetch falso que registra as chamadas e responde conforme o handler. */
function fakeFetch(handler: Handler) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = async (input: string | URL, init: RequestInit = {}) => {
    const url = input.toString();
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fn, calls };
}

function tokenResponse(accessToken = "novo-token") {
  return Response.json({
    access_token: accessToken,
    expires_in: 60 * 24 * 3600,
    token_type: "bearer",
  });
}

function setup(handler: Handler, initialToken: StoredToken | null = null) {
  const fetch = fakeFetch(handler);
  const tokenStore = createMemoryTokenStore(initialToken);
  const client = createIgdbClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    tokenStore,
    fetch: fetch.fn,
    now: () => NOW,
    sleep: async () => {},
    minIntervalMs: 0,
  });
  return { client, tokenStore, calls: fetch.calls };
}

const isTokenCall = (url: string) => url.startsWith("https://id.twitch.tv/");

describe("createIgdbClient", () => {
  test("obtém o token, guarda e reutiliza", async () => {
    const { client, tokenStore, calls } = setup((url) =>
      isTokenCall(url) ? tokenResponse() : Response.json([{ id: 1 }]),
    );

    await client.query("games", "fields name;");
    await client.query("games", "fields name;");

    expect(calls.filter((c) => isTokenCall(c.url))).toHaveLength(1);
    expect(tokenStore.load()).toEqual({ accessToken: "novo-token", expiresAt: NOW + 60 * DAY });

    const apiCall = calls.find((c) => !isTokenCall(c.url))!;
    expect(apiCall.url).toBe("https://api.igdb.com/v4/games");
    expect(apiCall.init.body).toBe("fields name;");
    expect(apiCall.init.headers).toMatchObject({
      "Client-ID": "client-id",
      Authorization: "Bearer novo-token",
    });
  });

  test("envia o secret no corpo, não na URL", async () => {
    const { client, calls } = setup((url) =>
      isTokenCall(url) ? tokenResponse() : Response.json([]),
    );

    await client.query("games", "fields name;");

    const tokenCall = calls.find((c) => isTokenCall(c.url))!;
    expect(tokenCall.url).not.toContain("client-secret");
    expect(String(tokenCall.init.body)).toContain("client_secret=client-secret");
  });

  test("usa o token guardado se ainda estiver válido", async () => {
    const { client, calls } = setup(
      (url) => (isTokenCall(url) ? tokenResponse() : Response.json([])),
      { accessToken: "guardado", expiresAt: NOW + 30 * DAY },
    );

    await client.query("games", "fields name;");

    expect(calls.some((c) => isTokenCall(c.url))).toBe(false);
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: "Bearer guardado" });
  });

  test("renova o token perto de expirar", async () => {
    const { client, calls } = setup(
      (url) => (isTokenCall(url) ? tokenResponse() : Response.json([])),
      { accessToken: "quase-vencido", expiresAt: NOW + DAY / 2 },
    );

    await client.query("games", "fields name;");

    expect(calls.filter((c) => isTokenCall(c.url))).toHaveLength(1);
  });

  test("com 401, renova o token e tenta de novo uma vez", async () => {
    const { client, calls } = setup(
      (url, init) => {
        if (isTokenCall(url)) return tokenResponse();
        const auth = (init.headers as Record<string, string>).Authorization;
        return auth === "Bearer revogado"
          ? new Response("unauthorized", { status: 401 })
          : Response.json([{ id: 7 }]);
      },
      { accessToken: "revogado", expiresAt: NOW + 30 * DAY },
    );

    expect(await client.query("games", "fields name;")).toEqual([{ id: 7 }]);
    expect(calls.map((c) => (isTokenCall(c.url) ? "token" : "api"))).toEqual([
      "api",
      "token",
      "api",
    ]);
  });

  test("requisições simultâneas compartilham a mesma renovação de token", async () => {
    const { client, calls } = setup((url) =>
      isTokenCall(url) ? tokenResponse() : Response.json([]),
    );

    await Promise.all([client.query("games", "a"), client.query("games", "b")]);

    expect(calls.filter((c) => isTokenCall(c.url))).toHaveLength(1);
  });

  test("erro HTTP vira IgdbError com o detalhe", async () => {
    const { client } = setup((url) =>
      isTokenCall(url) ? tokenResponse() : new Response("Invalid Field", { status: 400 }),
    );

    const promise = client.query("games", "fields nope;");
    await expect(promise).rejects.toBeInstanceOf(IgdbError);
    await expect(promise).rejects.toThrow("HTTP 400 em /games: Invalid Field");
  });

  test("falha ao obter token vira IgdbError", async () => {
    const { client } = setup(() => new Response("bad", { status: 403 }));

    await expect(client.query("games", "fields name;")).rejects.toThrow(
      "token da Twitch (HTTP 403)",
    );
  });
});

describe("createThrottle", () => {
  test("espaça as chamadas pelo intervalo mínimo, mesmo concorrentes", async () => {
    let clock = 1000;
    const waits: number[] = [];
    const throttle = createThrottle(
      250,
      () => clock,
      async (ms) => {
        waits.push(ms);
      },
    );

    await Promise.all([throttle(), throttle(), throttle()]);
    expect(waits).toEqual([250, 500]);

    clock += 2000; // depois de um tempo ocioso, não espera
    await throttle();
    expect(waits).toEqual([250, 500]);
  });
});

describe("createKvTokenStore", () => {
  test("persiste o token na tabela kv", () => {
    const db = createTestDb();
    const store = createKvTokenStore(db);
    const token = { accessToken: "abc", expiresAt: NOW };

    expect(store.load()).toBeNull();
    store.save(token);
    expect(createKvTokenStore(db).load()).toEqual(token);
    store.clear();
    expect(store.load()).toBeNull();
  });
});

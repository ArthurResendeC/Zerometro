import { describe, expect, test } from "bun:test";
import { AchievementSourceError } from "../errors";
import { createJsonClient } from "./http-json";

function setup(handler: (url: URL) => Response | Promise<Response>) {
  const calls: URL[] = [];
  const sleeps: number[] = [];
  const client = createJsonClient({
    label: "a Fonte",
    baseUrl: "https://api.exemplo.com/v1/",
    defaultParams: { key: "segredo" },
    minIntervalMs: 0,
    fetch: async (input) => {
      const url = new URL(input.toString());
      calls.push(url);
      return handler(url);
    },
    now: () => 0,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { client, calls, sleeps };
}

describe("createJsonClient", () => {
  test("monta a URL com os parâmetros padrão e os da chamada", async () => {
    const { client, calls } = setup(() => Response.json({ ok: true }));

    expect(await client.get<{ ok: boolean }>("jogos", { id: 42, l: "brazilian" })).toEqual({
      ok: true,
    });
    expect(calls[0]?.toString()).toBe(
      "https://api.exemplo.com/v1/jogos?key=segredo&id=42&l=brazilian",
    );
  });

  test("tenta de novo uma vez depois de um 429", async () => {
    let n = 0;
    const { client, calls, sleeps } = setup(() =>
      n++ === 0 ? new Response(null, { status: 429 }) : Response.json([1]),
    );

    expect(await client.get<number[]>("x")).toEqual([1]);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([1000]);
  });

  test("HTTP de erro vira AchievementSourceError sem a chave na mensagem", async () => {
    const { client } = setup(() => new Response("proibido", { status: 403 }));

    const error = await client.get("jogos", { id: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AchievementSourceError);
    expect((error as Error).message).toBe("a Fonte respondeu HTTP 403 em jogos");
    expect((error as Error).message).not.toContain("segredo");
  });

  test("acceptStatus: devolve o corpo de um status de erro esperado", async () => {
    const { client } = setup(() => Response.json({ erro: "privado" }, { status: 403 }));

    expect(await client.get("x", {}, { acceptStatus: [403] })).toEqual({ erro: "privado" });
    await expect(client.get("x", {}, { acceptStatus: [400] })).rejects.toBeInstanceOf(
      AchievementSourceError,
    );
  });

  test("falha de rede e JSON inválido também viram AchievementSourceError", async () => {
    const offline = setup(() => Promise.reject(new TypeError("fetch failed")));
    await expect(offline.client.get("x")).rejects.toThrow("Falha de rede ao chamar a Fonte (x)");

    const html = setup(() => new Response("<html>", { status: 200 }));
    await expect(html.client.get("x")).rejects.toBeInstanceOf(AchievementSourceError);
  });
});

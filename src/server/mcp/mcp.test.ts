import { beforeEach, describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { eq } from "drizzle-orm";
import { activityLog, user } from "../db/schema";
import {
  createFakeIgdb,
  createTestApp,
  fakeIgdbGame,
  mockGoogleLogin,
  TEST_BASE_URL,
  TEST_EMAILS,
  TEST_TODAY,
} from "../testing";

// Fluxo completo de um conector MCP (como o do claude.ai): descoberta → registro dinâmico →
// login + consentimento → token → chamadas de tools, tudo contra o app de teste.

const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const MCP_URL = `${TEST_BASE_URL}/mcp`;

const igdb = createFakeIgdb([
  fakeIgdbGame(),
  fakeIgdbGame({ igdbId: 12517, name: "Undertale", timeToBeat: null }),
  fakeIgdbGame({ igdbId: 1, name: "Pokémon Red" }),
  fakeIgdbGame({ igdbId: 2, name: "Pokémon Blue" }),
]);

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
let t: TestApp;

beforeEach(async () => {
  t = await createTestApp({ igdb });
});

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function discover(app: TestApp) {
  const prm = (await (await app.fetchRoot("/.well-known/oauth-protected-resource/mcp")).json()) as {
    resource: string;
    authorization_servers: string[];
  };
  const issuer = new URL(prm.authorization_servers[0] ?? "");
  const metadata = (await (
    await app.fetchRoot(`/.well-known/oauth-authorization-server${issuer.pathname}`)
  ).json()) as Record<string, string>;
  return { prm, metadata };
}

/** Faz o fluxo OAuth inteiro como o usuário dono de `cookie` e devolve o access token. */
async function authorize(app: TestApp, cookie: string): Promise<string> {
  const { metadata } = await discover(app);
  const registered = (await (
    await app.fetchRoot(
      metadata.registration_endpoint ?? "",
      json({
        client_name: "Claude",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    )
  ).json()) as { client_id: string };

  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const challenge = new Bun.CryptoHasher("sha256").update(verifier).digest("base64url");
  const url = new URL(metadata.authorization_endpoint ?? "");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: registered.client_id,
    redirect_uri: REDIRECT_URI,
    scope: "openid offline_access",
    state: "estado",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: MCP_URL,
  }).toString();

  const toConsent = await app.fetchRoot(url.toString(), {
    redirect: "manual",
    headers: { cookie },
  });
  const consentPage = new URL(toConsent.headers.get("location") ?? "", TEST_BASE_URL);
  expect(consentPage.pathname).toBe("/autorizar");

  const consent = (await (
    await app.fetchRoot("/api/auth/oauth2/consent", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ accept: true, oauth_query: consentPage.search.slice(1) }),
    })
  ).json()) as { url: string };
  const callback = new URL(consent.url);
  expect(callback.searchParams.get("state")).toBe("estado");

  const token = (await (
    await app.fetchRoot(metadata.token_endpoint ?? "", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: callback.searchParams.get("code") ?? "",
        redirect_uri: REDIRECT_URI,
        client_id: registered.client_id,
        code_verifier: verifier,
        resource: MCP_URL,
      }),
    })
  ).json()) as { access_token: string; refresh_token?: string };
  expect(token.refresh_token).toBeString(); // offline_access: o conector renova sozinho
  return token.access_token;
}

async function connect(app: TestApp, accessToken: string) {
  const client = new Client({ name: "teste", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      fetch: (input, init) => app.fetchRoot(String(input), init),
      requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    }),
  );
  return client;
}

async function callJson(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as { type: string; text: string }[];
  return { isError: Boolean(result.isError), text: first?.text ?? "", data: tryJson(first?.text) };
}

function tryJson(text: string | undefined): any {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return undefined;
  }
}

describe("descoberta OAuth", () => {
  test("/mcp sem token → 401 apontando para os metadados do recurso", async () => {
    const res = await t.fetchRoot("/mcp", json({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      `resource_metadata="${TEST_BASE_URL}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  test("metadados do recurso e do servidor de autorização, com registro dinâmico", async () => {
    const { prm, metadata } = await discover(t);
    expect(prm.resource).toBe(MCP_URL);
    expect(metadata).toMatchObject({
      issuer: `${TEST_BASE_URL}/api/auth`,
      registration_endpoint: `${TEST_BASE_URL}/api/auth/oauth2/register`,
      authorization_endpoint: `${TEST_BASE_URL}/api/auth/oauth2/authorize`,
    });
  });

  test("login com Google no meio do fluxo continua direto para o consentimento", async () => {
    const restore = mockGoogleLogin(TEST_EMAILS.friend);
    try {
      const { metadata } = await discover(t);
      const { client_id } = (await (
        await t.fetchRoot(
          metadata.registration_endpoint ?? "",
          json({ redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none" }),
        )
      ).json()) as { client_id: string };
      const url = new URL(metadata.authorization_endpoint ?? "");
      url.search = new URLSearchParams({
        response_type: "code",
        client_id,
        redirect_uri: REDIRECT_URI,
        scope: "openid offline_access",
        code_challenge: "x".repeat(43),
        code_challenge_method: "S256",
        resource: MCP_URL,
      }).toString();
      const login = new URL(
        (await t.fetchRoot(url.toString(), { redirect: "manual" })).headers.get("location") ?? "",
        TEST_BASE_URL,
      );

      // O que a tela /entrar faz: POST do login social com a query assinada (oauth_query).
      const start = await t.fetchRoot("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json", origin: TEST_BASE_URL },
        body: JSON.stringify({
          provider: "google",
          callbackURL: "/",
          errorCallbackURL: "/entrar",
          oauth_query: login.search.slice(1),
        }),
      });
      const google = new URL(((await start.json()) as { url: string }).url);
      const cookie = start.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");

      // Volta do Google (navegação do navegador): em vez do callbackURL, segue o fluxo OAuth
      // até o consentimento. Sem os cabeçalhos de navegação, o plugin responde em JSON.
      const back = await t.fetchRoot(
        `/api/auth/callback/google?code=codigo&state=${google.searchParams.get("state")}`,
        {
          headers: { cookie, accept: "text/html", "sec-fetch-mode": "navigate" },
          redirect: "manual",
        },
      );
      const next = new URL(back.headers.get("location") ?? "", TEST_BASE_URL);
      expect(next.pathname).toBe("/autorizar");
      expect(next.searchParams.get("client_id")).toBe(client_id);
    } finally {
      restore();
    }
  });

  test("sem sessão, o authorize manda para a tela de login com a query assinada", async () => {
    const { metadata } = await discover(t);
    const url = new URL(metadata.authorization_endpoint ?? "");
    const registered = (await (
      await t.fetchRoot(
        metadata.registration_endpoint ?? "",
        json({ redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none" }),
      )
    ).json()) as { client_id: string };
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: registered.client_id,
      redirect_uri: REDIRECT_URI,
      code_challenge: "x".repeat(43),
      code_challenge_method: "S256",
      resource: MCP_URL,
    }).toString();
    const res = await t.fetchRoot(url.toString(), { redirect: "manual" });
    const login = new URL(res.headers.get("location") ?? "", TEST_BASE_URL);
    expect(login.pathname).toBe("/entrar");
    expect(login.searchParams.get("sig")).toBeString();
  });
});

describe("tools", () => {
  test("token de um convidado: lê a biblioteca, os jogos e as estatísticas dele", async () => {
    await t.request("/api/library", json({ igdbId: 114283, status: "playing" }));
    await t.request("/api/library", json({ igdbId: 1, status: "finished" }));
    await t.request("/api/library", json({ igdbId: 2, status: "backlog" }));
    await t.request("/api/sessions", json({ gameId: 1, minutes: 45 }));

    const cookie = (await t.helpers.login({ userId: t.userId })).headers.get("cookie") ?? "";
    const client = await connect(t, await authorize(t, cookie));

    const { tools } = await client.listTools();
    const readOnly = tools
      .filter((tool) => tool.annotations?.readOnlyHint)
      .map((tool) => tool.name);
    expect(readOnly.toSorted()).toEqual([
      "get_active_session",
      "get_game",
      "get_stats",
      "list_library",
      "list_sessions",
      "search_igdb",
    ]);
    // Nenhuma tool apaga dados por enquanto.
    expect(tools.some((tool) => tool.annotations?.destructiveHint)).toBe(false);

    const playing = await callJson(client, "list_library", { status: "playing" });
    expect(playing.data.games.map((g: { name: string }) => g.name)).toEqual(["Persona 5 Royal"]);

    const game = await callJson(client, "get_game", { game: "persona" });
    expect(game.data).toMatchObject({ name: "Persona 5 Royal", minutesPlayed: 45 });
    expect(game.data.recentSessions).toHaveLength(1);

    // "pokemon" (sem acento) bate com dois: devolve as opções em vez de chutar.
    const ambiguous = await callJson(client, "get_game", { game: "pokemon" });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain("Pokémon Red");
    expect(ambiguous.text).toContain("Pokémon Blue");

    const exact = await callJson(client, "get_game", { game: "pokemon blue" });
    expect(exact.data).toMatchObject({ name: "Pokémon Blue", status: "backlog" });

    const missing = await callJson(client, "get_game", { game: "zelda" });
    expect(missing).toMatchObject({ isError: true });

    const stats = await callJson(client, "get_stats");
    expect(stats.data).toMatchObject({ todayMinutes: 45 });

    const sessions = await callJson(client, "list_sessions", { game: 1 });
    expect(sessions.data.sessions).toHaveLength(1);

    expect((await callJson(client, "get_active_session")).data).toEqual({ active: null });

    const search = await callJson(client, "search_igdb", { query: "undertale" });
    expect(search.data.results[0]).toMatchObject({ igdbId: 12517, name: "Undertale" });

    await client.close();
  });

  test("escrita: adiciona jogo, timer, registra sessão e muda status, como actor mcp", async () => {
    const cookie = (await t.helpers.login({ userId: t.userId })).headers.get("cookie") ?? "";
    const client = await connect(t, await authorize(t, cookie));

    const added = await callJson(client, "add_game", { igdbId: 12517 });
    expect(added.data).toMatchObject({ name: "Undertale", status: "backlog" });
    expect((await callJson(client, "add_game", { igdbId: 12517 })).isError).toBe(true);
    await callJson(client, "add_game", {
      igdbId: 114283,
      status: "playing",
      platformPlayed: "PS5",
    });

    // Timer: começa em Undertale (Próximos → Jogando), não troca sozinho de jogo.
    const started = await callJson(client, "start_session", { game: "undertale" });
    expect(started.data).toMatchObject({
      active: { gameName: "Undertale" },
      alreadyRunning: false,
      statusChangedTo: "playing",
    });
    const again = await callJson(client, "start_session", { game: "undertale" });
    expect(again.data.alreadyRunning).toBe(true);
    const busy = await callJson(client, "start_session", { game: "persona" });
    expect(busy.isError).toBe(true);
    expect(busy.text).toContain("replaceActive");

    t.clock.set(new Date(t.clock.now().getTime() + 50 * 60_000));
    const stopped = await callJson(client, "stop_session", { note: "Ruínas" });
    expect(stopped.data).toMatchObject({
      discarded: false,
      session: { minutes: 50, note: "Ruínas", source: "timer" },
      dayTotalMinutes: 50,
    });
    expect((await callJson(client, "stop_session")).isError).toBe(true);

    // Sessão sem timer: fonte "mcp", soma no dia e no jogo.
    const logged = await callJson(client, "log_session", { game: "persona", minutes: 90 });
    expect(logged.data).toMatchObject({
      session: { minutes: 90, source: "mcp" },
      dayTotalMinutes: 140,
      gameTotalMinutes: 90,
    });
    expect(
      (await callJson(client, "log_session", { game: "persona", minutes: 2000 })).isError,
    ).toBe(true);

    const finished = await callJson(client, "set_status", {
      game: "undertale",
      status: "finished",
    });
    expect(finished.data).toMatchObject({
      status: "finished",
      previousStatus: "playing",
      finishedAt: TEST_TODAY,
    });

    // Tudo aparece no site e no histórico com actor "mcp".
    const { items } = (await (await t.request("/api/library")).json()) as {
      items: { name: string; status: string }[];
    };
    expect(items.find((item) => item.name === "Undertale")?.status).toBe("finished");
    const actors = t.db.select({ actor: activityLog.actor }).from(activityLog).all();
    expect(new Set(actors.map((row) => row.actor))).toEqual(new Set(["mcp"]));

    await client.close();
  });

  test("cada token só enxerga os dados do próprio usuário", async () => {
    await t.request("/api/library", json({ igdbId: 114283, status: "playing" }));
    const friend = await t.loginAs(TEST_EMAILS.friend);

    const client = await connect(t, await authorize(t, friend.headers.get("cookie") ?? ""));
    expect((await callJson(client, "list_library")).data).toEqual({ games: [] });
    await client.close();
  });

  test("quem sai da lista de convidados perde o acesso na hora (403), mesmo com token válido", async () => {
    const friend = await t.loginAs(TEST_EMAILS.friend);
    const token = await authorize(t, friend.headers.get("cookie") ?? "");

    // Mesmo efeito de tirar o e-mail de ALLOWED_EMAILS: o e-mail da conta não está mais na lista.
    t.db
      .update(user)
      .set({ email: "ex-amigo@zerometro.test" })
      .where(eq(user.id, friend.userId))
      .run();
    const res = await t.fetchRoot("/mcp", {
      ...json({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
    });
    expect(res.status).toBe(403);
  });

  test("token inválido → 401", async () => {
    const res = await t.fetchRoot("/mcp", {
      ...json({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      headers: { "content-type": "application/json", authorization: "Bearer lixo" },
    });
    expect(res.status).toBe(401);
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  auth,
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  type OAuthClientInformationMixed,
  type OAuthClientProvider,
  type OAuthTokens,
} from "@modelcontextprotocol/client";
import { createOAuthServer, MCP_PATH, type OAuthUsers } from "./server";
import { ACCESS_TTL_S, fingerprint as fingerprintOf, makeSigner, s256 } from "./tokens";

// O servidor OAuth como o claude.ai o alcança: por HTTP de verdade, na frente de um /mcp que só
// ecoa. O cliente de referência do SDK do MCP faz o papel do claude.ai, então descoberta,
// registro, PKCE e refresh são conferidos como um cliente real os lê.

const TOKEN = "token-do-dono-para-os-testes-com-32-caracteres";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const verifier = `${"v".repeat(43)}erifier-dos-testes`;

let nowMs = Date.now();

// Os perfis da instância: o admin (sem senha, aprova com o token) e um amigo.
const profiles = new Map<string, { password?: string; ver: number; disabled?: boolean }>();
const resetProfiles = () => {
  profiles.clear();
  profiles.set("owner", { ver: 0 });
  profiles.set("joao", { password: "senha-do-joao", ver: 0 });
};
resetProfiles();
const users: OAuthUsers = {
  approve: async (handle, password) => {
    if (!handle)
      return password === TOKEN
        ? { id: "owner", sessionVersion: profiles.get("owner")!.ver }
        : undefined;
    const p = profiles.get(handle);
    return p?.password && p.password === password && !p.disabled
      ? { id: handle, sessionVersion: p.ver }
      : undefined;
  },
  sessionVersion: (id) => {
    const p = profiles.get(id);
    return p && !p.disabled ? p.ver : undefined;
  },
  ownerId: "owner",
};
let base: string;
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  // O emissor precisa ser conhecido antes do servidor escutar: a porta vem primeiro.
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port;
  void probe.stop(true);
  base = `http://127.0.0.1:${port}`;
  const oauth = createOAuthServer({
    publicUrl: base,
    secret: TOKEN,
    adminToken: TOKEN,
    users,
    now: () => nowMs,
    log: () => {},
  });
  server = Bun.serve({
    port,
    routes: {
      ...oauth.routes,
      [MCP_PATH]: oauth.protect(async (_request, userId) => Response.json({ ok: true, userId })),
    },
    fetch: () => new Response("Not found", { status: 404 }),
  });
});

afterAll(() => server.stop(true));

const postMcp = (headers: Record<string, string> = {}) =>
  fetch(`${base}${MCP_PATH}`, { method: "POST", headers, body: "{}" });

const register = async (body: Record<string, unknown>) => {
  const res = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, string> };
};

const publicClient = async (redirect = CALLBACK) =>
  (
    await register({
      client_name: "Claude",
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
    })
  ).body.client_id as string;

const authorizeQuery = (clientId: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CALLBACK,
    code_challenge: s256(verifier),
    code_challenge_method: "S256",
    state: "est4do",
    resource: `${base}${MCP_PATH}`,
    ...extra,
  });

/** Responde o form de consentimento (o admin com o token, ou um perfil), sem seguir o redirect. */
const answer = (
  query: URLSearchParams,
  decision: string,
  password = TOKEN,
  handle = "",
  headers: Record<string, string> = {},
) =>
  fetch(`${base}/authorize`, {
    method: "POST",
    redirect: "manual",
    headers,
    body: new URLSearchParams([
      ...query,
      ["decision", decision],
      ["handle", handle],
      ["password", password],
    ]),
  });

const location = (res: Response) => new URL(res.headers.get("location") ?? "");

const codeFor = async (
  clientId: string,
  extra: Record<string, string> = {},
  as: { handle: string; password: string } = { handle: "", password: TOKEN },
) =>
  location(
    await answer(authorizeQuery(clientId, extra), "allow", as.password, as.handle),
  ).searchParams.get("code") ?? "";

const tokenRequest = (params: Record<string, string>, headers: Record<string, string> = {}) =>
  fetch(`${base}/token`, { method: "POST", headers, body: new URLSearchParams(params) });

const tokensFor = async (clientId: string, as?: { handle: string; password: string }) => {
  const res = await tokenRequest({
    grant_type: "authorization_code",
    code: await codeFor(clientId, {}, as),
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: CALLBACK,
    resource: `${base}${MCP_PATH}`,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as OAuthTokens;
};

describe("descoberta", () => {
  test("/mcp sem token responde 401 com o desafio que leva aos metadados", async () => {
    const res = await postMcp();
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain(
      `resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
    );
    expect(challenge).not.toContain("invalid_token");
  });

  test("o SDK acha o recurso e o servidor de autorização", async () => {
    const prm = await discoverOAuthProtectedResourceMetadata(`${base}${MCP_PATH}`);
    expect(prm.resource).toBe(`${base}${MCP_PATH}`);
    expect(prm.authorization_servers).toEqual([base]);
    const metadata = await discoverAuthorizationServerMetadata(base);
    expect(metadata?.registration_endpoint).toBe(`${base}/register`);
    expect(metadata?.code_challenge_methods_supported).toEqual(["S256"]);
  });
});

describe("fluxo completo com o cliente do SDK", () => {
  test("registra, autoriza com o token, troca o código e usa o /mcp; o refresh gira o par", async () => {
    let client: OAuthClientInformationMixed | undefined;
    let tokens: OAuthTokens | undefined;
    let authorizationUrl: URL | undefined;
    let codeVerifier = "";
    const provider: OAuthClientProvider = {
      redirectUrl: CALLBACK,
      clientMetadata: {
        client_name: "Claude",
        redirect_uris: [CALLBACK],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      clientInformation: () => client,
      saveClientInformation: (info) => {
        client = info;
      },
      tokens: () => tokens,
      saveTokens: (saved) => {
        tokens = saved;
      },
      redirectToAuthorization: (url) => {
        authorizationUrl = url;
      },
      saveCodeVerifier: (v) => {
        codeVerifier = v;
      },
      codeVerifier: () => codeVerifier,
    };

    expect(await auth(provider, { serverUrl: `${base}${MCP_PATH}` })).toBe("REDIRECT");
    expect(authorizationUrl?.pathname).toBe("/authorize");

    // O dono abre a página e aprova com o token.
    const page = await fetch(authorizationUrl!);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<strong>Claude</strong>");
    const approved = await answer(authorizationUrl!.searchParams, "allow");
    expect(approved.status).toBe(303);
    const callback = location(approved);
    expect(callback.origin + callback.pathname).toBe(CALLBACK);
    expect(callback.searchParams.get("iss")).toBe(base);
    expect(callback.searchParams.get("state")).toBe(authorizationUrl!.searchParams.get("state"));

    expect(
      await auth(provider, {
        serverUrl: `${base}${MCP_PATH}`,
        authorizationCode: callback.searchParams.get("code") ?? "",
        iss: callback.searchParams.get("iss") ?? undefined,
      }),
    ).toBe("AUTHORIZED");
    expect(tokens?.access_token).toStartWith("zm_at.");
    expect(tokens?.refresh_token).toStartWith("zm_rt.");
    expect((await postMcp({ authorization: `Bearer ${tokens!.access_token}` })).status).toBe(200);

    // Access token vencido: o refresh traz um par novo, que funciona.
    const old = tokens!;
    nowMs += (ACCESS_TTL_S + 1) * 1000;
    try {
      expect((await postMcp({ authorization: `Bearer ${old.access_token}` })).status).toBe(401);
      expect(await auth(provider, { serverUrl: `${base}${MCP_PATH}` })).toBe("AUTHORIZED");
      expect(tokens!.refresh_token).not.toBe(old.refresh_token);
      expect((await postMcp({ authorization: `Bearer ${tokens!.access_token}` })).status).toBe(200);
    } finally {
      nowMs = Date.now();
    }
  });

  test("o próprio token da instância vale como Bearer no /mcp (clientes configurados à mão)", async () => {
    expect((await postMcp({ authorization: `Bearer ${TOKEN}` })).status).toBe(200);
    expect((await postMcp({ authorization: `Bearer ${TOKEN}x` })).status).toBe(401);
  });
});

describe("registro", () => {
  test("só os callbacks do claude.ai e endereços de loopback recebem código", async () => {
    const allowed = await Promise.all(
      [
        CALLBACK,
        "https://claude.com/api/mcp/auth_callback",
        "http://localhost:6274/oauth/callback",
        "http://127.0.0.1:33418/callback",
      ].map((uri) => register({ redirect_uris: [uri] })),
    );
    expect(allowed.map((res) => res.status)).toEqual([201, 201, 201, 201]);
    const refused = await Promise.all(
      [
        "https://evil.example/callback",
        "https://claude.ai.evil.example/api/mcp/auth_callback",
        "https://localhost/callback",
        "cursor://anysphere.cursor-retrieval/oauth/callback",
        "http://localhost:3000/cb#fragmento",
      ].map((uri) => register({ redirect_uris: [uri] })),
    );
    for (const res of refused) {
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_redirect_uri");
    }
  });

  test("cliente confidencial ganha segredo, público não", async () => {
    const confidential = await register({ redirect_uris: [CALLBACK] });
    expect(confidential.body.token_endpoint_auth_method).toBe("client_secret_basic");
    expect(confidential.body.client_secret).toBeString();
    const pub = await register({ redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" });
    expect(pub.body.client_secret).toBeUndefined();
  });

  test("corpo que não é um objeto JSON é recusado", async () => {
    const answers = await Promise.all(
      ["não é json", "[]", "null"].map(async (body) => {
        const res = await fetch(`${base}/register`, { method: "POST", body });
        return { status: res.status, error: ((await res.json()) as { error: string }).error };
      }),
    );
    for (const reply of answers) {
      expect(reply).toEqual({ status: 400, error: "invalid_client_metadata" });
    }
  });

  test("dois registros iguais são dois clientes", async () => {
    expect(await publicClient()).not.toBe(await publicClient());
  });
});

describe("autorização", () => {
  test("escapa o nome do cliente, e o CSP só deixa o form ir para cá e para o cliente", async () => {
    const { body } = await register({
      client_name: `<script>alert("x")</script>`,
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: "none",
    });
    const res = await fetch(`${base}/authorize?${authorizeQuery(body.client_id ?? "")}`);
    const html = await res.text();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action 'self' https://claude.ai");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  test("cliente desconhecido ou redirect não registrado ganham uma página, nunca um redirect", async () => {
    const forged = await fetch(`${base}/authorize?${authorizeQuery("zm_client.x.y")}`, {
      redirect: "manual",
    });
    expect(forged.status).toBe(400);
    expect(forged.headers.get("location")).toBeNull();

    const clientId = await publicClient();
    const elsewhere = await fetch(
      `${base}/authorize?${authorizeQuery(clientId, { redirect_uri: "http://localhost:9/cb" })}`,
      { redirect: "manual" },
    );
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.headers.get("location")).toBeNull();
  });

  test("sem PKCE S256 volta ao cliente como invalid_request; outro recurso, como invalid_target", async () => {
    const clientId = await publicClient();
    const plain = await fetch(
      `${base}/authorize?${authorizeQuery(clientId, { code_challenge_method: "plain" })}`,
      { redirect: "manual" },
    );
    expect(plain.status).toBe(303);
    expect(location(plain).searchParams.get("error")).toBe("invalid_request");
    expect(location(plain).searchParams.get("state")).toBe("est4do");

    const other = await fetch(
      `${base}/authorize?${authorizeQuery(clientId, { resource: "https://outro.example/mcp" })}`,
      { redirect: "manual" },
    );
    expect(location(other).searchParams.get("error")).toBe("invalid_target");
  });

  test("senha ou token errado mostra a página de novo sem código; cancelar manda access_denied", async () => {
    const clientId = await publicClient();
    const wrong = await answer(authorizeQuery(clientId), "allow", "nao-e-o-token");
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("location")).toBeNull();
    expect(await wrong.text()).toContain('role="alert"');

    const denied = await answer(authorizeQuery(clientId), "deny");
    expect(location(denied).searchParams.get("error")).toBe("access_denied");
    expect(location(denied).searchParams.get("code")).toBeNull();
  });
});

describe("token", () => {
  test("um código vale uma vez só", async () => {
    const clientId = await publicClient();
    const code = await codeFor(clientId);
    const params = { grant_type: "authorization_code", code, code_verifier: verifier };
    expect((await tokenRequest({ ...params, client_id: clientId })).status).toBe(200);
    const again = await tokenRequest({ ...params, client_id: clientId });
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toBe("invalid_grant");
  });

  test("código vencido não vale", async () => {
    const clientId = await publicClient();
    const code = await codeFor(clientId);
    nowMs += 6 * 60 * 1000;
    try {
      const res = await tokenRequest({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: clientId,
      });
      expect(res.status).toBe(400);
    } finally {
      nowMs = Date.now();
    }
  });

  test("verifier errado, outro cliente ou outro redirect dão invalid_grant", async () => {
    const clientId = await publicClient();
    const other = await publicClient();
    const cases: Record<string, string>[] = [
      { client_id: clientId, code_verifier: `${"x".repeat(43)}outro` },
      { client_id: other, code_verifier: verifier },
      { client_id: clientId, code_verifier: verifier, redirect_uri: "http://localhost:1/cb" },
    ];
    const answers = await Promise.all(
      cases.map(async (params) => {
        const res = await tokenRequest({
          grant_type: "authorization_code",
          code: await codeFor(clientId),
          ...params,
        });
        return { status: res.status, error: ((await res.json()) as { error: string }).error };
      }),
    );
    for (const reply of answers) expect(reply).toEqual({ status: 400, error: "invalid_grant" });
  });

  test("cliente confidencial prova o segredo, por Basic ou no corpo", async () => {
    const { body } = await register({ redirect_uris: [CALLBACK] });
    const id = body.client_id ?? "";
    const secret = body.client_secret ?? "";
    const basic = (s: string) => ({
      authorization: `Basic ${btoa(`${encodeURIComponent(id)}:${encodeURIComponent(s)}`)}`,
    });
    const grant = async () => ({
      grant_type: "authorization_code",
      code: await codeFor(id),
      code_verifier: verifier,
    });

    expect((await tokenRequest(await grant(), basic(secret))).status).toBe(200);
    expect(
      (await tokenRequest({ ...(await grant()), client_id: id, client_secret: secret })).status,
    ).toBe(200);
    const wrong = await tokenRequest(await grant(), basic("errado"));
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("www-authenticate")).toContain("Basic");
    expect((await tokenRequest({ ...(await grant()), client_id: id })).status).toBe(401);
  });

  test("o refresh token é do cliente dele; grant desconhecido é recusado", async () => {
    const clientId = await publicClient();
    const { refresh_token } = await tokensFor(clientId);
    const other = await publicClient();
    const stolen = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: refresh_token ?? "",
      client_id: other,
    });
    expect(stolen.status).toBe(400);
    const unknown = await tokenRequest({ grant_type: "password", client_id: clientId });
    expect(((await unknown.json()) as { error: string }).error).toBe("unsupported_grant_type");
  });

  test("as respostas nunca vão para cache", async () => {
    const res = await register({ redirect_uris: [CALLBACK] });
    expect(res.status).toBe(201);
    const clientId = await publicClient();
    const tokenRes = await tokenRequest({
      grant_type: "authorization_code",
      code: await codeFor(clientId),
      code_verifier: verifier,
      client_id: clientId,
    });
    expect(tokenRes.headers.get("cache-control")).toBe("no-store");
  });
});

describe("/mcp", () => {
  test("recusa token forjado, vencido, de outro recurso ou refresh token", async () => {
    const clientId = await publicClient();
    const { access_token, refresh_token } = await tokensFor(clientId);
    const [prefix, payload] = access_token.split(".");
    const forger = makeSigner("outro-segredo-qualquer-com-32-caracteres");
    const foreign = makeSigner(TOKEN).sign("access", {
      cid: "x",
      aud: "https://outro.example/mcp",
      scope: "zerometro",
      exp: Math.floor(nowMs / 1000) + 60,
      jti: "j",
    });
    const forged = forger.sign("access", {
      cid: "x",
      aud: `${base}${MCP_PATH}`,
      scope: "zerometro",
      exp: Math.floor(nowMs / 1000) + 60,
      jti: "j",
    });
    const answers = await Promise.all(
      [`${prefix}.${payload}.assinatura`, forged, foreign, refresh_token ?? ""].map((bad) =>
        postMcp({ authorization: `Bearer ${bad}` }),
      ),
    );
    for (const res of answers) {
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
    }
  });

  test("rotas desconhecidas e métodos errados", async () => {
    const oauth = createOAuthServer({
      publicUrl: base,
      secret: TOKEN,
      adminToken: TOKEN,
      users,
      log: () => {},
    });
    expect((await oauth.fetch(new Request(`${base}/nada`))).status).toBe(404);
    expect((await oauth.fetch(new Request(`${base}/token`))).status).toBe(405);
  });
});

/** De quem o /mcp acha que é o token (ou o status, se recusou). */
const mcpAs = async (access: string) => {
  const res = await postMcp({ authorization: `Bearer ${access}` });
  return res.status === 200 ? ((await res.json()) as { userId: string }).userId : res.status;
};
describe("perfis", () => {
  const joao = { handle: "joao", password: "senha-do-joao" };

  test("cada perfil aprova com a própria senha, e o /mcp sabe de quem é o token", async () => {
    resetProfiles();
    const clientId = await publicClient();
    const mine = await tokensFor(clientId);
    const his = await tokensFor(clientId, joao);
    expect(await mcpAs(mine.access_token)).toBe("owner");
    expect(await mcpAs(his.access_token)).toBe("joao");
    expect(await mcpAs(TOKEN)).toBe("owner");
  });

  test("a página mantém o @apelido digitado quando a senha erra", async () => {
    resetProfiles();
    const clientId = await publicClient();
    const wrong = await answer(authorizeQuery(clientId), "allow", "errada", "joao");
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toContain('value="joao"');
  });

  test("trocar a senha (versão nova) ou suspender o perfil corta access e refresh", async () => {
    resetProfiles();
    const clientId = await publicClient();
    const his = await tokensFor(clientId, joao);
    const refresh = () =>
      tokenRequest({
        grant_type: "refresh_token",
        refresh_token: his.refresh_token ?? "",
        client_id: clientId,
      });

    profiles.get("joao")!.ver = 1;
    expect(await mcpAs(his.access_token)).toBe(401);
    expect((await refresh()).status).toBe(400);

    profiles.get("joao")!.ver = 0;
    profiles.get("joao")!.disabled = true;
    expect(await mcpAs(his.access_token)).toBe(401);
    expect((await refresh()).status).toBe(400);
    resetProfiles();
  });

  test("token de antes dos perfis (sem sub) vale como o admin, e o refresh dá um dono", async () => {
    resetProfiles();
    const clientId = await publicClient();
    const signer = makeSigner(TOKEN);
    const grant = (exp: number) => ({
      cid: fingerprintOf(clientId),
      aud: `${base}${MCP_PATH}`,
      scope: "zerometro",
      exp,
      jti: "legado",
    });
    const at = Math.floor(nowMs / 1000);
    expect(await mcpAs(signer.sign("access", grant(at + 60)))).toBe("owner");
    const res = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: signer.sign("refresh", grant(at + 3600)),
      client_id: clientId,
    });
    expect(res.status).toBe(200);
    const fresh = (await res.json()) as OAuthTokens;
    expect(signer.verify("access", fresh.access_token)).toMatchObject({ sub: "owner", ver: 0 });
  });

  test("10 senhas erradas seguidas no mesmo perfil: 429", async () => {
    resetProfiles();
    const clientId = await publicClient();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        answer(authorizeQuery(clientId), "allow", "errada", "joao", {
          "x-forwarded-for": `10.1.0.${i}`,
        }),
      ),
    );
    const blocked = await answer(authorizeQuery(clientId), "allow", joao.password, "joao");
    expect(blocked.status).toBe(429);
  });
});

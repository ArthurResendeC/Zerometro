// O servidor de autorização OAuth 2.1 na frente do /mcp, como a especificação de autorização do
// MCP pede a um servidor remoto: metadados do recurso protegido (RFC 9728) e do servidor
// (RFC 8414), registro dinâmico de clientes (RFC 7591), authorization code só com PKCE S256,
// refresh tokens girados a cada uso e access tokens presos ao /mcp desta instância (RFC 8707).
// Os erros são os do OAuth (`{ error, error_description }`), não os da API: é o que os clientes leem.
//
// O "login" do fluxo é o ZEROMETRO_TOKEN, digitado na página de consentimento.
//
// Portado do my-scratchpad (https://github.com/Levieber/my-scratchpad, src/mcp/oauth/, MIT).
import { consentHeaders, consentPage, errorPage } from "./consent";
import {
  ACCESS_TTL_S,
  AUTH_METHODS,
  type AuthMethod,
  type ClientInfo,
  fingerprint,
  type Grant,
  makeSigner,
  randomToken,
  REFRESH_TTL_S,
  s256,
  sameSecret,
  SCOPE,
} from "./tokens";

export const MCP_PATH = "/mcp";

// Para onde o claude.ai (web, desktop e celular) devolve a pessoa. Endereços de loopback são como
// um cliente na própria máquina (Claude Code, MCP Inspector) recebe o código; uma página em
// qualquer outro lugar nunca recebe um, nem com uma aprovação conseguida por phishing.
const CLAUDE_CALLBACKS = new Set([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function allowedRedirect(uri: string): boolean {
  if (CLAUDE_CALLBACKS.has(uri)) return true;
  try {
    const url = new URL(uri);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) && !url.hash;
  } catch {
    return false;
  }
}

// RFC 7636: de 43 a 128 caracteres não reservados, no verifier e (base64url de um SHA-256) no desafio.
const PKCE = /^[\w.~-]{43,128}$/;

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_REDIRECTS = 10;
const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };

interface Code {
  cid: string;
  redirectUri: string;
  challenge: string;
  expiresAt: number;
}

type Handler = (request: Request) => Promise<Response>;
type MethodRoutes = Partial<Record<"GET" | "POST", Handler>>;

const oauthError = (
  status: number,
  error: string,
  description: string,
  headers: Record<string, string> = {},
) =>
  Response.json(
    { error, error_description: description },
    { status, headers: { ...NO_STORE, ...headers } },
  );

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const formDecode = (part: string) => decodeURIComponent(part.replace(/\+/g, " "));

const html = (body: string, status: number, headers: Record<string, string>) =>
  new Response(body, { status, headers });

/** `client_id:client_secret` do HTTP Basic, cada um codificado como form (RFC 6749 §2.3.1). */
function basicCredentials(header: string | null) {
  const match = /^Basic\s+(\S+)$/i.exec(header ?? "");
  if (!match?.[1]) return undefined;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 0) return undefined;
  try {
    return {
      id: formDecode(decoded.slice(0, colon)),
      secret: formDecode(decoded.slice(colon + 1)),
    };
  } catch {
    return undefined;
  }
}

/** Corpo ilegível é problema do cliente; qualquer outra falha é nossa, e vai para o log. */
const guarded =
  (handler: Handler): Handler =>
  async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return oauthError(400, "invalid_request", "Unreadable request");
      }
      console.error("[oauth]", error);
      return oauthError(500, "server_error", "Internal error");
    }
  };

export interface OAuthConfig {
  /** Origem pública desta instância: é o emissor, e o recurso é o `/mcp` nela. */
  publicUrl: string;
  /** ZEROMETRO_TOKEN: o que o dono digita para aprovar um conector, e de onde sai a chave. */
  ownerToken: string;
  /** Relógio em ms (injetável nos testes). */
  now?: () => number;
  /** Log de registros e aprovações (silenciado nos testes). */
  log?: (message: string) => void;
}

export function createOAuthServer({
  publicUrl,
  ownerToken,
  now = Date.now,
  log = (message) => console.info(`[oauth] ${message}`),
}: OAuthConfig) {
  const signer = makeSigner(ownerToken);
  const resource = `${publicUrl}${MCP_PATH}`;
  const resourceMetadataUrl = `${publicUrl}/.well-known/oauth-protected-resource${MCP_PATH}`;
  // Códigos vivem poucos minutos e valem uma vez, então memória basta (uma réplica só): um
  // redeploy no meio custa uma nova aprovação.
  const codes = new Map<string, Code>();

  // Um cliente nomeia o recurso como recebeu; barra no fim ou a origem pura continuam sendo daqui.
  const isThisResource = (value: string | null) =>
    value === null || [resource, publicUrl].includes(value.replace(/\/+$/, ""));

  const protectedResource = async () =>
    Response.json({
      resource,
      authorization_servers: [publicUrl],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "Zerômetro",
    });

  const authorizationServer = async () =>
    Response.json({
      issuer: publicUrl,
      authorization_endpoint: `${publicUrl}/authorize`,
      token_endpoint: `${publicUrl}/token`,
      registration_endpoint: `${publicUrl}/register`,
      scopes_supported: [SCOPE],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: AUTH_METHODS,
      authorization_response_iss_parameter_supported: true,
    });

  const register: Handler = async (request) => {
    let body: unknown;
    try {
      body = JSON.parse(await request.text());
    } catch {
      return oauthError(400, "invalid_client_metadata", "The body must be JSON");
    }
    if (!isObject(body)) {
      return oauthError(400, "invalid_client_metadata", "The body must be a JSON object");
    }
    const uris = body.redirect_uris;
    // O registro é aberto a qualquer um, e o client_id carrega a lista: ela fica curta.
    if (
      !Array.isArray(uris) ||
      uris.length === 0 ||
      uris.length > MAX_REDIRECTS ||
      !uris.every((u): u is string => typeof u === "string" && u.length <= 2048)
    ) {
      return oauthError(
        400,
        "invalid_redirect_uri",
        `redirect_uris must be a list of 1 to ${MAX_REDIRECTS} URLs`,
      );
    }
    const refused = uris.find((u) => !allowedRedirect(u));
    if (refused !== undefined) {
      return oauthError(
        400,
        "invalid_redirect_uri",
        `${refused} is not allowed: this server sends codes only to claude.ai and to loopback addresses`,
      );
    }
    // O padrão da RFC 7591 é client_secret_basic.
    const auth = body.token_endpoint_auth_method ?? "client_secret_basic";
    if (!AUTH_METHODS.includes(auth as AuthMethod)) {
      return oauthError(
        400,
        "invalid_client_metadata",
        `token_endpoint_auth_method must be one of ${AUTH_METHODS.join(", ")}`,
      );
    }
    const name =
      typeof body.client_name === "string" ? body.client_name.trim().slice(0, 100) : undefined;
    const iat = Math.floor(now() / 1000);
    const info: ClientInfo = {
      redirect_uris: uris,
      auth: auth as AuthMethod,
      iat,
      jti: randomToken(16),
    };
    if (name) info.name = name;
    const clientId = signer.sign("client", info);
    log(`cliente registrado: ${name ?? "sem nome"}`);
    return Response.json(
      {
        client_id: clientId,
        client_id_issued_at: iat,
        ...(info.auth !== "none" && {
          client_secret: signer.clientSecret(clientId),
          client_secret_expires_at: 0,
        }),
        ...(name && { client_name: name }),
        redirect_uris: uris,
        token_endpoint_auth_method: info.auth,
        // O que este servidor concede, seja o que for pedido (a RFC 7591 deixa substituir).
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: SCOPE,
      },
      { status: 201, headers: NO_STORE },
    );
  };

  type Checked =
    | { kind: "page"; message: string }
    | { kind: "redirect"; redirectUri: string; error: string; description: string; state?: string }
    | {
        kind: "ok";
        clientId: string;
        client: ClientInfo;
        redirectUri: string;
        challenge: string;
        state?: string;
        /** O pedido como o form de consentimento leva até o POST. */
        params: Record<string, string>;
      };

  // As mesmas checagens para a página (GET) e a resposta (POST). Até o cliente e o redirect se
  // provarem genuínos, nada pode voltar para ele; depois disso, os erros voltam (RFC 6749 §4.1.2.1).
  const checkAuthorization = (q: URLSearchParams): Checked => {
    const clientId = q.get("client_id") ?? "";
    const client = signer.verify("client", clientId);
    if (!client) {
      return {
        kind: "page",
        message:
          "O aplicativo que pediu acesso não está registrado nesta instância. Remova o conector e conecte de novo.",
      };
    }
    const asked = q.get("redirect_uri");
    const redirectUri =
      asked ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : undefined);
    if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
      return {
        kind: "page",
        message: "O aplicativo pediu para voltar a um endereço que ele não registrou.",
      };
    }
    const state = q.get("state") ?? undefined;
    const back = (error: string, description: string): Checked => ({
      kind: "redirect",
      redirectUri,
      error,
      description,
      ...(state !== undefined && { state }),
    });
    if (q.get("response_type") !== "code") {
      return back("unsupported_response_type", "Only the authorization code flow is supported");
    }
    const challenge = q.get("code_challenge") ?? "";
    if (q.get("code_challenge_method") !== "S256" || !PKCE.test(challenge)) {
      return back("invalid_request", "PKCE with code_challenge_method S256 is required");
    }
    if (!isThisResource(q.get("resource"))) {
      return back("invalid_target", `This server only grants access to ${resource}`);
    }
    const params: Record<string, string> = {
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
    };
    if (state !== undefined) params.state = state;
    const asResource = q.get("resource");
    if (asResource !== null) params.resource = asResource;
    return {
      kind: "ok",
      clientId,
      client,
      redirectUri,
      challenge,
      params,
      ...(state !== undefined && { state }),
    };
  };

  const redirectTo = (redirectUri: string, params: Record<string, string | undefined>) => {
    const url = new URL(redirectUri);
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(name, value);
    }
    url.searchParams.set("iss", publicUrl);
    // 303: o navegador segue a resposta de um POST com um GET.
    return new Response(null, { status: 303, headers: { ...NO_STORE, location: url.toString() } });
  };

  const notOk = (checked: Exclude<Checked, { kind: "ok" }>) =>
    checked.kind === "page"
      ? html(errorPage(checked.message), 400, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        })
      : redirectTo(checked.redirectUri, {
          error: checked.error,
          error_description: checked.description,
          state: checked.state,
        });

  const authorizePage: Handler = async (request) => {
    const checked = checkAuthorization(new URL(request.url).searchParams);
    if (checked.kind !== "ok") return notOk(checked);
    return html(
      consentPage({
        clientName: checked.client.name,
        redirectUri: checked.redirectUri,
        params: checked.params,
      }),
      200,
      consentHeaders(checked.redirectUri),
    );
  };

  const authorizeAnswer: Handler = async (request) => {
    const form = new URLSearchParams(await request.text());
    const checked = checkAuthorization(form);
    if (checked.kind !== "ok") return notOk(checked);
    const who = checked.client.name ?? "sem nome";
    if (form.get("decision") !== "allow") {
      log(`acesso negado: ${who}`);
      return redirectTo(checked.redirectUri, {
        error: "access_denied",
        error_description: "The owner denied access",
        state: checked.state,
      });
    }
    if (!sameSecret(form.get("token") ?? "", ownerToken)) {
      log(`aprovação recusada (token errado): ${who}`);
      return html(
        consentPage({
          clientName: checked.client.name,
          redirectUri: checked.redirectUri,
          params: checked.params,
          error: "Esse não é o token desta instância (ZEROMETRO_TOKEN).",
        }),
        401,
        consentHeaders(checked.redirectUri),
      );
    }
    const at = now();
    for (const [code, entry] of codes) if (entry.expiresAt <= at) codes.delete(code);
    const code = randomToken();
    codes.set(code, {
      cid: fingerprint(checked.clientId),
      redirectUri: checked.redirectUri,
      challenge: checked.challenge,
      expiresAt: at + CODE_TTL_MS,
    });
    log(`acesso autorizado: ${who} → ${new URL(checked.redirectUri).host}`);
    return redirectTo(checked.redirectUri, { code, state: checked.state });
  };

  const tokens = (cid: string, at: number) => {
    const seconds = Math.floor(at / 1000);
    const grant = (ttl: number): Grant => ({
      cid,
      aud: resource,
      scope: SCOPE,
      exp: seconds + ttl,
      jti: randomToken(16),
    });
    return Response.json(
      {
        access_token: signer.sign("access", grant(ACCESS_TTL_S)),
        token_type: "Bearer",
        expires_in: ACCESS_TTL_S,
        refresh_token: signer.sign("refresh", grant(REFRESH_TTL_S)),
        scope: SCOPE,
      },
      { headers: NO_STORE },
    );
  };

  const token: Handler = async (request) => {
    const form = new URLSearchParams(await request.text());
    const basic = basicCredentials(request.headers.get("authorization"));
    const challenge = basic ? { "www-authenticate": 'Basic realm="zerometro"' } : undefined;
    if (basic && form.has("client_id") && form.get("client_id") !== basic.id) {
      return oauthError(400, "invalid_request", "Two different client ids");
    }
    const clientId = basic?.id ?? form.get("client_id") ?? "";
    const client = signer.verify("client", clientId);
    if (!client) {
      return oauthError(401, "invalid_client", "Unknown client: connect again", challenge);
    }
    if (client.auth !== "none") {
      const secret = basic?.secret ?? form.get("client_secret") ?? "";
      if (!sameSecret(secret, signer.clientSecret(clientId))) {
        return oauthError(401, "invalid_client", "Wrong client secret", challenge);
      }
    }
    const cid = fingerprint(clientId);
    const at = now();
    if (!isThisResource(form.get("resource"))) {
      return oauthError(400, "invalid_target", `This server only grants access to ${resource}`);
    }

    switch (form.get("grant_type")) {
      case "authorization_code": {
        const code = form.get("code") ?? "";
        const entry = codes.get(code);
        // Gasto aconteça o que acontecer: um código vale uma tentativa.
        codes.delete(code);
        const verifier = form.get("code_verifier") ?? "";
        const redirectUri = form.get("redirect_uri");
        if (
          !entry ||
          entry.expiresAt <= at ||
          entry.cid !== cid ||
          (redirectUri !== null && redirectUri !== entry.redirectUri) ||
          !PKCE.test(verifier) ||
          !sameSecret(s256(verifier), entry.challenge)
        ) {
          return oauthError(400, "invalid_grant", "The code is unknown, expired or not yours");
        }
        return tokens(cid, at);
      }
      case "refresh_token": {
        const grant = signer.verify("refresh", form.get("refresh_token") ?? "");
        if (!grant || grant.exp * 1000 <= at || grant.cid !== cid || grant.aud !== resource) {
          return oauthError(
            400,
            "invalid_grant",
            "The refresh token is unknown, expired or not yours",
          );
        }
        return tokens(cid, at);
      }
      default:
        return oauthError(
          400,
          "unsupported_grant_type",
          "grant_type must be authorization_code or refresh_token",
        );
    }
  };

  /** Rotas no formato do `Bun.serve` (por método), todas na raiz do domínio. */
  const routes: Record<string, MethodRoutes> = {
    "/.well-known/oauth-protected-resource": { GET: protectedResource },
    [`/.well-known/oauth-protected-resource${MCP_PATH}`]: { GET: protectedResource },
    "/.well-known/oauth-authorization-server": { GET: authorizationServer },
    "/register": { POST: guarded(register) },
    "/authorize": { GET: guarded(authorizePage), POST: guarded(authorizeAnswer) },
    "/token": { POST: guarded(token) },
  };

  const challengeFor = (invalid: boolean) =>
    [
      `Bearer resource_metadata="${resourceMetadataUrl}"`,
      `scope="${SCOPE}"`,
      ...(invalid
        ? ['error="invalid_token"', 'error_description="The access token is invalid or expired"']
        : []),
    ].join(", ");

  /**
   * Protege o endpoint MCP. Vale um access token deste servidor para este recurso, ou o próprio
   * ZEROMETRO_TOKEN (para clientes configurados à mão, ex.: `claude mcp add --header`). Sem
   * nenhum dos dois: 401 com o desafio que leva o cliente à descoberta (RFC 9728 §5.1).
   */
  const protect =
    (handler: Handler): Handler =>
    async (request) => {
      const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
      const presented = match?.[1];
      if (presented && sameSecret(presented, ownerToken)) return handler(request);
      const grant = presented ? signer.verify("access", presented) : undefined;
      if (!grant || grant.exp * 1000 <= now() || grant.aud !== resource) {
        return Response.json(
          { error: { code: "unauthorized", message: "Conecte o aplicativo de novo" } },
          { status: 401, headers: { "www-authenticate": challengeFor(match !== null) } },
        );
      }
      return handler(request);
    };

  /** Despacha uma requisição para as rotas acima (testes e servidores sem roteador por método). */
  const fetch: Handler = async (request) => {
    const route = routes[new URL(request.url).pathname];
    if (!route) return new Response("Not found", { status: 404 });
    const handler = route[request.method as keyof MethodRoutes];
    if (!handler) {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: Object.keys(route).join(", ") },
      });
    }
    return handler(request);
  };

  return { routes, protect, fetch, resource };
}

export type OAuthServer = ReturnType<typeof createOAuthServer>;

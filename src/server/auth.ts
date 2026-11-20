// Autenticação de uma instância self-hosted: cada instância é de uma pessoa, e quem tem o
// ZEROMETRO_TOKEN (do .env) entra.
// - Site: digita o token em /entrar e ganha um cookie assinado de 30 dias, renovado a cada dia
//   de uso. Não fica nada guardado no banco: trocar o token desloga todos os aparelhos.
// - API por script: `Authorization: Bearer <token>`.
// - MCP: OAuth próprio (src/server/oauth), aprovado com o mesmo token, ou o token como Bearer.
import { createHmac } from "node:crypto";
import { createOAuthServer, type OAuthServer } from "./oauth/server";
import { sameSecret } from "./oauth/tokens";

export { OWNER_ID } from "../shared/auth";

export const SESSION_COOKIE = "zerometro_session";
export const SESSION_DAYS = 30;
const SESSION_TTL_S = SESSION_DAYS * 24 * 60 * 60;
/** O cookie é reemitido (mais 30 dias) quando tem mais que isso: um dia de uso renova. */
const RENEW_AFTER_S = 24 * 60 * 60;
/** Tamanho mínimo do token: com 32 caracteres aleatórios, força bruta é inviável. */
export const MIN_TOKEN_LENGTH = 32;

interface SessionPayload {
  /** Emitido em (segundos desde a época). */
  iat: number;
  /** Vence em (segundos desde a época). */
  exp: number;
}

export interface AuthConfig {
  /** ZEROMETRO_TOKEN. */
  token: string;
  /** URL pública do site (emissor do OAuth; https liga o cookie `Secure`). */
  publicUrl: string;
  /** Relógio em ms (injetável nos testes). */
  now?: () => number;
  /** Log do OAuth (silenciado nos testes). */
  log?: (message: string) => void;
}

export interface CookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "Lax";
  path: "/";
  maxAge: number;
}

export interface Auth {
  /** O token confere (tempo constante)? */
  isToken: (candidate: string) => boolean;
  /** Valor de um cookie de sessão novo, de 30 dias. */
  issueSession: () => string;
  /** O cookie é válido? `renew` diz se já vale reemitir. */
  checkSession: (value: string | undefined) => { valid: boolean; renew: boolean };
  /** Opções do cookie de sessão (`maxAge` 0 apaga). */
  cookieOptions: (maxAge?: number) => CookieOptions;
  /** Servidor OAuth do MCP (rotas na raiz e o `protect` do /mcp). */
  oauth: OAuthServer;
}

const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

export function createAuth({ token, publicUrl, now = Date.now, log }: AuthConfig): Auth {
  // Chave própria para as sessões: o cookie nunca vale como outra coisa assinada com o token.
  const key = createHmac("sha256", token).update("zerometro/session/v1").digest();
  const mac = (data: string) => base64url(createHmac("sha256", key).update(data).digest());
  const seconds = () => Math.floor(now() / 1000);

  const issueSession = () => {
    const iat = seconds();
    const payload = base64url(JSON.stringify({ iat, exp: iat + SESSION_TTL_S }));
    return `${payload}.${mac(payload)}`;
  };

  const checkSession = (value: string | undefined) => {
    const invalid = { valid: false, renew: false };
    const [payload, signature, ...rest] = (value ?? "").split(".");
    if (!payload || !signature || rest.length > 0) return invalid;
    if (!sameSecret(signature, mac(payload))) return invalid;
    let session: SessionPayload;
    try {
      session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      return invalid;
    }
    const at = seconds();
    if (typeof session.exp !== "number" || session.exp <= at) return invalid;
    return { valid: true, renew: at - session.iat >= RENEW_AFTER_S };
  };

  return {
    isToken: (candidate) => sameSecret(candidate, token),
    issueSession,
    checkSession,
    cookieOptions: (maxAge = SESSION_TTL_S) => ({
      httpOnly: true,
      secure: publicUrl.startsWith("https:"),
      sameSite: "Lax",
      path: "/",
      maxAge,
    }),
    oauth: createOAuthServer({ publicUrl, ownerToken: token, now, log }),
  };
}

/**
 * URL pública do site: emissor do OAuth do MCP e origem do recurso /mcp. Em produção, cair em
 * localhost quebraria os conectores, então falha no boot com uma mensagem clara.
 */
export function resolvePublicUrl(env: {
  NODE_ENV: string;
  PORT: number;
  PUBLIC_URL?: string;
  RAILWAY_PUBLIC_DOMAIN?: string;
}): string {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, "");
  if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Defina PUBLIC_URL com a URL pública do site (ex.: https://zerometro.exemplo.com)",
    );
  }
  return `http://localhost:${env.PORT}`;
}

/** Problema com o ZEROMETRO_TOKEN que impede o servidor de subir, ou null. */
export function tokenProblem(token: string | undefined): string | null {
  if (!token) return "Defina ZEROMETRO_TOKEN no .env (gere com: mise run token)";
  if (token.length < MIN_TOKEN_LENGTH) {
    return `ZEROMETRO_TOKEN precisa de pelo menos ${MIN_TOKEN_LENGTH} caracteres (gere com: mise run token)`;
  }
  return null;
}

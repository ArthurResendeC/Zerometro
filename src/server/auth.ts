// Autenticação da instância: cada pessoa tem um perfil (convidado pelo admin) e entra com o
// @apelido e a senha; o admin (`owner`) também entra com o ZEROMETRO_TOKEN (do .env).
// - Site: ganha um cookie assinado de 30 dias, renovado a cada dia de uso, com o id do perfil e a
//   versão da sessão dele (trocar a senha ou "sair de todos" incrementa e derruba os cookies).
//   A chave sai do SESSION_SECRET (ou, sem ele, do token): trocá-la desloga todo mundo.
// - API por script: `Authorization: Bearer <token>` (vale como o admin).
// - MCP: OAuth próprio (src/server/oauth), aprovado com o perfil, ou o token como Bearer.
import { createHmac } from "node:crypto";
import type { Db } from "./db/client";
import { createOAuthServer, type OAuthServer, type OAuthUsers } from "./oauth/server";
import { sameSecret } from "./oauth/tokens";
import { getActiveUser, getOwner, verifyLogin } from "./services/users";
import { OWNER_ID } from "../shared/auth";

export { OWNER_ID };

export const SESSION_COOKIE = "zerometro_session";
export const SESSION_DAYS = 30;
const SESSION_TTL_S = SESSION_DAYS * 24 * 60 * 60;
/** O cookie é reemitido (mais 30 dias) quando tem mais que isso: um dia de uso renova. */
const RENEW_AFTER_S = 24 * 60 * 60;
/** Tamanho mínimo do token: com 32 caracteres aleatórios, força bruta é inviável. */
export const MIN_TOKEN_LENGTH = 32;

interface SessionPayload {
  /** Id do perfil. */
  uid: string;
  /** `session_version` do perfil quando o cookie foi emitido. */
  ver: number;
  /** Emitido em (segundos desde a época). */
  iat: number;
  /** Vence em (segundos desde a época). */
  exp: number;
}

export interface AuthConfig {
  /** ZEROMETRO_TOKEN: entra como o admin. */
  token: string;
  /** SESSION_SECRET: chave dos cookies e do OAuth; sem ele, sai do token. */
  sessionSecret?: string;
  /** URL pública do site (emissor do OAuth; https liga o cookie `Secure`). */
  publicUrl: string;
  /** Banco dos perfis (aprovar conectores e conferir se o perfil continua ativo). */
  db: Db;
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
  /** Valor de um cookie de sessão novo, de 30 dias, para o perfil. */
  issueSession: (who: SessionUser) => string;
  /**
   * A assinatura e o prazo do cookie conferem? Devolve de quem é (a versão ainda precisa bater
   * com a do banco); `renew` diz se já vale reemitir.
   */
  checkSession: (value: string | undefined) => (SessionUser & { renew: boolean }) | undefined;
  /** Opções do cookie de sessão (`maxAge` 0 apaga). */
  cookieOptions: (maxAge?: number) => CookieOptions;
  /** Servidor OAuth do MCP (rotas na raiz e o `protect` do /mcp). */
  oauth: OAuthServer;
}

/** O que o cookie identifica: o perfil e a versão da sessão dele. */
export interface SessionUser {
  id: string;
  sessionVersion: number;
}

const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

export function createAuth({
  token,
  sessionSecret,
  publicUrl,
  db,
  now = Date.now,
  log,
}: AuthConfig): Auth {
  const secret = sessionSecret || token;
  const isToken = (candidate: string) => sameSecret(candidate, token);
  const users: OAuthUsers = {
    // Sem @apelido, a "senha" é o token do admin.
    approve: async (handle, password) =>
      handle ? verifyLogin(db, handle, password) : isToken(password) ? getOwner(db) : undefined,
    sessionVersion: (id) => getActiveUser(db, id)?.sessionVersion,
    ownerId: OWNER_ID,
  };
  // Chave própria para as sessões: o cookie nunca vale como outra coisa assinada com o segredo.
  const key = createHmac("sha256", secret).update("zerometro/session/v2").digest();
  const mac = (data: string) => base64url(createHmac("sha256", key).update(data).digest());
  const seconds = () => Math.floor(now() / 1000);

  const issueSession = (who: SessionUser) => {
    const iat = seconds();
    const session: SessionPayload = {
      uid: who.id,
      ver: who.sessionVersion,
      iat,
      exp: iat + SESSION_TTL_S,
    };
    const payload = base64url(JSON.stringify(session));
    return `${payload}.${mac(payload)}`;
  };

  const checkSession = (value: string | undefined) => {
    const invalid = undefined;
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
    if (typeof session.uid !== "string" || typeof session.ver !== "number") return invalid;
    return {
      id: session.uid,
      sessionVersion: session.ver,
      renew: at - session.iat >= RENEW_AFTER_S,
    };
  };

  return {
    isToken,
    issueSession,
    checkSession,
    cookieOptions: (maxAge = SESSION_TTL_S) => ({
      httpOnly: true,
      secure: publicUrl.startsWith("https:"),
      sameSite: "Lax",
      path: "/",
      maxAge,
    }),
    oauth: createOAuthServer({ publicUrl, secret, adminToken: token, users, now, log }),
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

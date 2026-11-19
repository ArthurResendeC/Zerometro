import { mcp, requireMcpAuth } from "@better-auth/mcp";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import type { Db } from "./db/client";
import {
  account,
  activityLog,
  kv,
  libraryEntries,
  playSessions,
  session,
  oauthSchema,
  user,
  verification,
} from "./db/schema";

// Login com Google via Better Auth. Usuários e sessões ficam no próprio SQLite;
// só entra quem está em ALLOWED_EMAILS (o primeiro da lista é o dono da instância).
// A mesma Better Auth é o servidor OAuth 2.1 dos clientes MCP (plugin `mcp`): o conector
// do Claude se registra sozinho, o usuário entra com o Google e autoriza em /autorizar.

/** Telas do front usadas no fluxo OAuth dos clientes MCP. */
export const OAUTH_LOGIN_PAGE = "/entrar";
export const OAUTH_CONSENT_PAGE = "/autorizar";

/** Identificador do recurso protegido (RFC 8707): a URL pública do endpoint MCP. */
export const mcpResourceFor = (baseURL: string) => `${baseURL}/mcp`;

export interface AuthConfig {
  db: Db;
  secret: string;
  baseURL: string;
  google?: { clientId: string; clientSecret: string };
  /** E-mails convidados; o primeiro é o dono (adota os dados de antes do login). */
  allowedEmails: string[];
  /** Plugins extras (ex.: testUtils nos testes). */
  plugins?: BetterAuthPlugin[];
}

/** Dono provisório criado pela migration 0002 para os dados de antes do login. */
export const LEGACY_OWNER_ID = "legacy-owner";

const SESSION_DAYS = 30;

/** O código vira `?error=not_invited` no redirect do callback do Google (tela de login). */
export const NOT_INVITED = "not_invited";

const notInvited = () =>
  new APIError("FORBIDDEN", {
    code: NOT_INVITED,
    message: "Esse e-mail não está na lista de convidados",
  });

export function createAuth(config: AuthConfig) {
  const allowed = new Set(config.allowedEmails.map(normalizeEmail));
  const owner = config.allowedEmails[0] ? normalizeEmail(config.allowedEmails[0]) : null;
  const isAllowed = (email: string) => allowed.has(normalizeEmail(email));

  return betterAuth({
    appName: "Zerômetro",
    baseURL: config.baseURL,
    secret: config.secret,
    database: drizzleAdapter(config.db, {
      provider: "sqlite",
      schema: { user, session, account, verification, ...oauthSchema },
    }),
    socialProviders: config.google
      ? { google: { ...config.google, prompt: "select_account" } }
      : {},
    advanced: {
      // Atrás do proxy da Railway o IP do cliente vem em X-Real-IP (usado no rate limit
      // da Better Auth, que só fica ligado em produção).
      ipAddress: { ipAddressHeaders: ["x-real-ip"] },
    },
    session: {
      // Uso pessoal no celular e no PC: sessão longa, renovada a cada dia de uso.
      expiresIn: 60 * 60 * 24 * SESSION_DAYS,
      updateAge: 60 * 60 * 24,
    },
    databaseHooks: {
      user: {
        create: {
          before: async (newUser) => {
            if (!isAllowed(newUser.email)) throw notInvited();
          },
          after: async (created) => {
            if (normalizeEmail(created.email) === owner) adoptLegacyData(config.db, created.id);
          },
        },
      },
      session: {
        create: {
          // Também barra quem já tinha conta e saiu da lista de convidados.
          before: async (newSession) => {
            const found = config.db
              .select({ email: user.email })
              .from(user)
              .where(eq(user.id, newSession.userId))
              .get();
            if (!found || !isAllowed(found.email)) throw notInvited();
          },
        },
      },
    },
    // O /token do plugin jwt devolveria um JWT da sessão do site: não pode servir de access token.
    disabledPaths: ["/token"],
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      mcp({
        loginPage: OAUTH_LOGIN_PAGE,
        consentPage: OAUTH_CONSENT_PAGE,
        resource: mcpResourceFor(config.baseURL),
        // Conectores (claude.ai, Claude Code...) se registram sozinhos (RFC 7591). Registrar
        // não dá acesso a nada: o token só sai depois do login de um convidado e do consentimento.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        // claude.ai usa callback https; Claude Code e Inspector, http://localhost.
        clientRegistrationDefaultApplicationType: "infer",
      }),
      ...(config.plugins ?? []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** O que o app precisa da autenticação (injetável nos testes). */
export interface AuthGateway {
  /** Rotas da Better Auth em /api/auth/* (login, callback do Google, logout...). */
  handler: (request: Request) => Promise<Response>;
  /** Usuário logado (e ainda convidado) dono da requisição, ou null. */
  getUserId: (headers: Headers) => Promise<string | null>;
  /**
   * Protege o endpoint MCP: valida o access token (assinatura, emissor, audiência = /mcp,
   * validade) e entrega o id do usuário, se ele ainda for convidado. Sem token → 401 com o
   * `WWW-Authenticate` que leva o cliente à descoberta OAuth.
   */
  protectMcp: (
    handler: (request: Request, userId: string) => Promise<Response>,
  ) => (request: Request) => Promise<Response>;
}

export function createAuthGateway(auth: Auth, allowedEmails: string[]): AuthGateway {
  const allowed = new Set(allowedEmails.map(normalizeEmail));
  const resource = mcpResourceFor(auth.options.baseURL as string);
  return {
    handler: (request) => auth.handler(request),
    getUserId: async (headers) => {
      const current = await auth.api.getSession({ headers });
      if (!current || !allowed.has(normalizeEmail(current.user.email))) return null;
      return current.user.id;
    },
    protectMcp: (handler) =>
      requireMcpAuth(
        auth,
        async (request, claims) => {
          const found = claims.sub
            ? await (await auth.$context).internalAdapter.findUserById(claims.sub)
            : null;
          // Saiu da lista de convidados: o token (que vale até 1h) para de funcionar na hora.
          if (!found || !allowed.has(normalizeEmail(found.email))) {
            return Response.json(
              {
                error: {
                  code: NOT_INVITED,
                  message: "Esse e-mail não está na lista de convidados",
                },
              },
              { status: 403 },
            );
          }
          return handler(request, found.id);
        },
        { resource },
      ),
  };
}

/** O dono assume os dados criados antes do login (biblioteca, sessões, ajustes e log). */
export function adoptLegacyData(db: Db, userId: string): boolean {
  const legacy = db.select({ id: user.id }).from(user).where(eq(user.id, LEGACY_OWNER_ID)).get();
  if (!legacy) return false;
  db.transaction((tx) => {
    tx.update(libraryEntries)
      .set({ userId })
      .where(eq(libraryEntries.userId, LEGACY_OWNER_ID))
      .run();
    tx.update(playSessions).set({ userId }).where(eq(playSessions.userId, LEGACY_OWNER_ID)).run();
    tx.update(activityLog).set({ userId }).where(eq(activityLog.userId, LEGACY_OWNER_ID)).run();
    tx.update(kv)
      .set({ key: `settings:${userId}` })
      .where(eq(kv.key, `settings:${LEGACY_OWNER_ID}`))
      .run();
    tx.delete(user).where(eq(user.id, LEGACY_OWNER_ID)).run();
  });
  return true;
}

/**
 * URL pública do site, que a Better Auth usa como origem confiável e para montar o
 * redirect do Google. Em produção, cair em localhost quebra o login (403 "Invalid
 * origin"), então falha no boot com uma mensagem clara.
 */
export function resolvePublicUrl(env: {
  NODE_ENV: string;
  PORT: number;
  BETTER_AUTH_URL?: string;
  RAILWAY_PUBLIC_DOMAIN?: string;
}): string {
  if (env.BETTER_AUTH_URL) return env.BETTER_AUTH_URL.replace(/\/+$/, "");
  if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Defina BETTER_AUTH_URL com a URL pública do site (ex.: https://zerometro.exemplo.com)",
    );
  }
  return `http://localhost:${env.PORT}`;
}

export function parseEmailList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

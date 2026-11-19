import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import type { Db } from "./db/client";
import {
  account,
  activityLog,
  kv,
  libraryEntries,
  playSessions,
  session,
  user,
  verification,
} from "./db/schema";

// Login com Google via Better Auth. Usuários e sessões ficam no próprio SQLite;
// só entra quem está em ALLOWED_EMAILS (o primeiro da lista é o dono da instância).

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
      schema: { user, session, account, verification },
    }),
    socialProviders: config.google
      ? { google: { ...config.google, prompt: "select_account" } }
      : {},
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
    plugins: config.plugins ?? [],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** O que o app precisa da autenticação (injetável nos testes). */
export interface AuthGateway {
  /** Rotas da Better Auth em /api/auth/* (login, callback do Google, logout...). */
  handler: (request: Request) => Promise<Response>;
  /** Usuário logado (e ainda convidado) dono da requisição, ou null. */
  getUserId: (headers: Headers) => Promise<string | null>;
}

export function createAuthGateway(auth: Auth, allowedEmails: string[]): AuthGateway {
  const allowed = new Set(allowedEmails.map(normalizeEmail));
  return {
    handler: (request) => auth.handler(request),
    getUserId: async (headers) => {
      const current = await auth.api.getSession({ headers });
      if (!current || !allowed.has(normalizeEmail(current.user.email))) return null;
      return current.user.id;
    },
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

export function parseEmailList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

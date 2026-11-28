import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import {
  acceptResetSchema,
  acceptSignupSchema,
  type AuthSession,
  loginInputSchema,
} from "../../shared/auth";
import type { AppDeps } from "../app";
import { type Auth, SESSION_COOKIE } from "../auth";
import type { Db } from "../db/client";
import type { ApiErrorBody } from "../errors";
import { clientIp, createAttemptLimiter } from "../lib/attempts";
import { createRouter, type AppEnv } from "../lib/hono";
import { validate } from "../lib/validate";
import {
  acceptReset,
  acceptSignup,
  type AuthUser,
  getActiveUser,
  getOwner,
  previewInvite,
  toSession,
  verifyLogin,
} from "../services/users";

// Entrar (com @apelido e senha, ou o admin com o token), sair e aceitar convites.

const bearer = (header: string | undefined) => /^Bearer\s+(\S+)$/i.exec(header ?? "")?.[1];

const tooMany = (c: Context) =>
  c.json<ApiErrorBody, 429>(
    {
      error: {
        code: "too_many_attempts",
        message: "Muitas tentativas erradas. Espere alguns minutos e tente de novo.",
      },
    },
    429,
  );

/** Rotas públicas: entrar, sair e os convites. */
export function createAuthRoutes(deps: Pick<AppDeps, "auth" | "db" | "clock">) {
  // Por IP (alguém chutando vários perfis) e por @apelido (vários IPs num perfil só).
  const attempts = createAttemptLimiter({ now: () => deps.clock.now().getTime() });

  const signIn = (c: Context<AppEnv>, who: AuthUser) => {
    setCookie(c, SESSION_COOKIE, deps.auth.issueSession(who), deps.auth.cookieOptions());
    return c.json<AuthSession>(toSession(who), 200);
  };

  return createRouter()
    .post("/login", validate("json", loginInputSchema), async (c) => {
      const input = c.req.valid("json");
      const ip = `ip:${clientIp(c.req.raw.headers)}`;
      // O token só conta por IP: senão, errar de propósito trancaria a entrada do admin.
      const account = "handle" in input ? `handle:${input.handle}` : undefined;
      if (!attempts.allowed(ip) || (account && !attempts.allowed(account))) return tooMany(c);

      const who =
        "token" in input
          ? deps.auth.isToken(input.token)
            ? getOwner(deps.db)
            : undefined
          : await verifyLogin(deps.db, input.handle, input.password);
      if (!who) {
        attempts.fail(ip);
        if (account) attempts.fail(account);
        const message = "token" in input ? "Token incorreto" : "@apelido ou senha incorretos";
        const code = "token" in input ? "invalid_token" : "invalid_credentials";
        return c.json<ApiErrorBody, 401>({ error: { code, message } }, 401);
      }
      if (account) attempts.reset(account);
      return signIn(c, who);
    })
    .post("/logout", (c) => {
      deleteCookie(c, SESSION_COOKIE, deps.auth.cookieOptions(0));
      return c.body(null, 204);
    })
    .get("/invites/:code", (c) =>
      c.json(previewInvite(deps.db, c.req.param("code"), deps.clock.now())),
    )
    .post("/invites/:code/signup", validate("json", acceptSignupSchema), async (c) => {
      const ip = `ip:${clientIp(c.req.raw.headers)}`;
      if (!attempts.allowed(ip)) return tooMany(c);
      try {
        const who = await acceptSignup(
          deps.db,
          c.req.param("code"),
          c.req.valid("json"),
          deps.clock.now(),
        );
        return signIn(c, who);
      } catch (error) {
        attempts.fail(ip);
        throw error;
      }
    })
    .post("/invites/:code/reset", validate("json", acceptResetSchema), async (c) => {
      const ip = `ip:${clientIp(c.req.raw.headers)}`;
      if (!attempts.allowed(ip)) return tooMany(c);
      try {
        const who = await acceptReset(
          deps.db,
          c.req.param("code"),
          c.req.valid("json"),
          deps.clock.now(),
        );
        return signIn(c, who);
      } catch (error) {
        attempts.fail(ip);
        throw error;
      }
    });
}

/**
 * Daqui para baixo, só com o cookie de sessão de um perfil ativo (na versão atual dele) ou o token
 * como Bearer (o admin). Um cookie com mais de um dia é reemitido (mais 30 dias), então quem usa
 * o site não precisa entrar de novo.
 */
export function requireAuth(deps: { auth: Auth; db: Db }): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = bearer(c.req.header("authorization"));
    let who: AuthUser | undefined;
    if (token && deps.auth.isToken(token)) {
      who = getOwner(deps.db);
    } else {
      const session = deps.auth.checkSession(getCookie(c, SESSION_COOKIE));
      const row = session && getActiveUser(deps.db, session.id);
      if (row && row.sessionVersion === session.sessionVersion) {
        who = row;
        if (session.renew) {
          setCookie(c, SESSION_COOKIE, deps.auth.issueSession(row), deps.auth.cookieOptions());
        }
      }
    }
    if (!who) {
      return c.json<ApiErrorBody>(
        { error: { code: "unauthorized", message: "Entre de novo para continuar" } },
        401,
      );
    }
    c.set("userId", who.id);
    c.set("user", who);
    await next();
  };
}

/** Só o admin (convidar, suspender, redefinir senha de alguém). */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("user").role !== "admin") {
    return c.json<ApiErrorBody>(
      { error: { code: "forbidden", message: "Só o admin da instância pode fazer isso" } },
      403,
    );
  }
  await next();
};

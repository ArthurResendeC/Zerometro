import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import { loginInputSchema, type AuthSession } from "../../shared/auth";
import type { AppDeps } from "../app";
import { type Auth, OWNER_ID, SESSION_COOKIE } from "../auth";
import type { ApiErrorBody } from "../errors";
import { createRouter, type AppEnv } from "../lib/hono";
import { validate } from "../lib/validate";

// Login do site: troca o token da instância por um cookie de sessão (30 dias).

const bearer = (header: string | undefined) => /^Bearer\s+(\S+)$/i.exec(header ?? "")?.[1];

/** Rotas públicas: entrar e sair. */
export function createAuthRoutes(deps: Pick<AppDeps, "auth">) {
  return createRouter()
    .post("/login", validate("json", loginInputSchema), (c) => {
      if (!deps.auth.isToken(c.req.valid("json").token)) {
        const body: ApiErrorBody = { error: { code: "invalid_token", message: "Token incorreto" } };
        return c.json(body, 401);
      }
      setCookie(c, SESSION_COOKIE, deps.auth.issueSession(), deps.auth.cookieOptions());
      const session: AuthSession = { userId: OWNER_ID };
      return c.json(session, 200);
    })
    .post("/logout", (c) => {
      deleteCookie(c, SESSION_COOKIE, deps.auth.cookieOptions(0));
      return c.body(null, 204);
    });
}

/**
 * Daqui para baixo, só com o cookie de sessão ou o token como Bearer. Um cookie com mais de um
 * dia é reemitido (mais 30 dias), então quem usa o site não precisa entrar de novo.
 */
export function requireAuth(auth: Auth): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = bearer(c.req.header("authorization"));
    const session = auth.checkSession(getCookie(c, SESSION_COOKIE));
    if (!session.valid && !(token && auth.isToken(token))) {
      return c.json<ApiErrorBody>(
        { error: { code: "unauthorized", message: "Entre com o token de acesso" } },
        401,
      );
    }
    if (session.renew) setCookie(c, SESSION_COOKIE, auth.issueSession(), auth.cookieOptions());
    c.set("userId", OWNER_ID);
    await next();
  };
}

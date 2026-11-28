import { setCookie } from "hono/cookie";
import type { Context } from "hono";
import { z } from "zod";
import {
  type AuthSession,
  changePasswordSchema,
  type CreatedInvite,
  createInviteSchema,
  updateMeSchema,
} from "../../shared/auth";
import type { AppDeps } from "../app";
import { SESSION_COOKIE } from "../auth";
import { createRouter, type AppEnv, webContext } from "../lib/hono";
import { validate } from "../lib/validate";
import { logActivity } from "../services/activity";
import {
  type AuthUser,
  changePassword,
  createInvite,
  createResetLink,
  listInvites,
  listUsers,
  revokeInvite,
  setUserDisabled,
  signOutEverywhere,
  toSession,
  updateProfile,
} from "../services/users";
import { requireAdmin } from "./auth";

type Deps = Pick<AppDeps, "db" | "clock" | "auth">;

/** Este aparelho continua logado depois de a versão da sessão mudar. */
function keepSignedIn(deps: Deps, c: Context<AppEnv>, who: AuthUser) {
  setCookie(c, SESSION_COOKIE, deps.auth.issueSession(who), deps.auth.cookieOptions());
  return c.json<AuthSession>(toSession(who), 200);
}

/** A própria conta: nome, avatar, senha e "sair de todos os aparelhos". */
export function createMeRoutes(deps: Deps) {
  return createRouter()
    .get("/", (c) => c.json<AuthSession>(toSession(c.get("user"))))
    .patch("/", validate("json", updateMeSchema), (c) =>
      c.json<AuthSession>(toSession(updateProfile(webContext(deps, c), c.req.valid("json")))),
    )
    .post("/password", validate("json", changePasswordSchema), async (c) =>
      keepSignedIn(deps, c, await changePassword(webContext(deps, c), c.req.valid("json"))),
    )
    .post("/sign-out-everywhere", (c) =>
      keepSignedIn(deps, c, signOutEverywhere(webContext(deps, c))),
    );
}

const inviteUrl = (deps: Deps, code: string) => `${deps.auth.publicUrl}/convite/${code}`;
const idParam = z.object({ id: z.coerce.number().int().positive() });

/** Só o admin: perfis da instância e convites. */
export function createAdminRoutes(deps: Deps) {
  return createRouter()
    .use(requireAdmin)
    .get("/users", (c) => c.json(listUsers(webContext(deps, c))))
    .post("/users/:id/disable", (c) => {
      setUserDisabled(webContext(deps, c), c.req.param("id"), true);
      return c.body(null, 204);
    })
    .post("/users/:id/enable", (c) => {
      setUserDisabled(webContext(deps, c), c.req.param("id"), false);
      return c.body(null, 204);
    })
    .post("/users/:id/reset-link", (c) => {
      const created = createResetLink(webContext(deps, c), c.req.param("id"));
      return c.json<CreatedInvite>(
        { id: created.id, url: inviteUrl(deps, created.code), expiresAt: created.expiresAt },
        201,
      );
    })
    .get("/invites", (c) => c.json(listInvites(webContext(deps, c))))
    .post("/invites", validate("json", createInviteSchema), (c) => {
      const ctx = webContext(deps, c);
      const created = createInvite(ctx.db, ctx, { note: c.req.valid("json").note });
      logActivity(ctx.db, ctx, "invite.create", { inviteId: created.id, kind: "signup" });
      return c.json<CreatedInvite>(
        { id: created.id, url: inviteUrl(deps, created.code), expiresAt: created.expiresAt },
        201,
      );
    })
    .delete("/invites/:id", validate("param", idParam), (c) => {
      revokeInvite(webContext(deps, c), c.req.valid("param").id);
      return c.body(null, 204);
    });
}

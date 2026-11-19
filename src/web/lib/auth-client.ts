import { createAuthClient } from "better-auth/react";

// Cliente da Better Auth: mesma origem, rotas em /api/auth/*.
export const authClient = createAuthClient();

export type AuthSession = NonNullable<Awaited<ReturnType<typeof authClient.getSession>>["data"]>;

/** Evita open redirect: só caminhos internos ("/algo", nunca "//outro-site"). */
export function safeRedirect(target: string | undefined): string {
  return target && target.startsWith("/") && !target.startsWith("//") ? target : "/";
}

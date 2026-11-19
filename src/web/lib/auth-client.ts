import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

// Cliente da Better Auth: mesma origem, rotas em /api/auth/*.
// oauthProviderClient: nas telas do fluxo OAuth dos clientes MCP (/entrar, /autorizar), manda
// a query assinada da URL junto de cada POST, para o servidor continuar o fluxo depois do login.
export const authClient = createAuthClient({ plugins: [oauthProviderClient()] });

/** A URL atual é uma etapa do fluxo OAuth (query assinada pelo servidor). */
export const isOAuthFlow = (search: Record<string, unknown>) =>
  typeof search.sig === "string" && typeof search.client_id === "string";

export type AuthSession = NonNullable<Awaited<ReturnType<typeof authClient.getSession>>["data"]>;

/** Evita open redirect: só caminhos internos ("/algo", nunca "//outro-site"). */
export function safeRedirect(target: string | undefined): string {
  return target && target.startsWith("/") && !target.startsWith("//") ? target : "/";
}

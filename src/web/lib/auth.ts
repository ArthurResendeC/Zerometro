import type { AuthSession } from "@shared/auth";
import { api, ApiError, unwrap } from "@/lib/api";

// Login do site com o token da instância: o servidor troca o token por um cookie de sessão
// (HttpOnly, 30 dias, renovado com o uso). O token não fica guardado no navegador.

export type { AuthSession };

/** Entra com o token; lança ApiError (401 = token errado). */
export async function signIn(token: string): Promise<AuthSession> {
  return unwrap(api.auth.login.$post({ json: { token } }));
}

/** Sai deste aparelho (apaga o cookie). */
export async function signOut(): Promise<void> {
  await api.auth.logout.$post();
}

/** Sessão atual: null se não entrou (401); lança em erro de rede (offline não é "deslogado"). */
export async function getSession(): Promise<AuthSession | null> {
  try {
    return await unwrap(api.auth.session.$get());
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** Evita open redirect: só caminhos internos ("/algo", nunca "//outro-site"). */
export function safeRedirect(target: string | undefined): string {
  return target && target.startsWith("/") && !target.startsWith("//") ? target : "/";
}

import type { QueryClient } from "@tanstack/react-query";
import type { AuthSession, LoginInput } from "@shared/auth";
import { clearPersistedQueries } from "@/features/offline/query-persistence";
import { api, ApiError, unwrap } from "@/lib/api";

// Login do site: o servidor troca o @apelido e a senha (ou o token da instância, para o admin)
// por um cookie de sessão (HttpOnly, 30 dias, renovado com o uso). Nada fica no navegador.

export type { AuthSession };

/** Entra; lança ApiError (401 = login errado, 429 = muitas tentativas). */
export async function signIn(input: LoginInput): Promise<AuthSession> {
  return unwrap(api.auth.login.$post({ json: input }));
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

/**
 * Troca de perfil neste aparelho (entrou, saiu ou aceitou um convite): nada do anterior pode
 * sobrar no cache, nem no guardado para uso offline.
 */
export async function resetDeviceCache(queryClient: QueryClient): Promise<void> {
  queryClient.clear();
  await clearPersistedQueries();
}

/** Evita open redirect: só caminhos internos ("/algo", nunca "//outro-site"). */
export function safeRedirect(target: string | undefined): string {
  return target && target.startsWith("/") && !target.startsWith("//") ? target : "/";
}

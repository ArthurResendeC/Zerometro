import { z } from "zod";

// Perfil da Steam do usuário, para sincronizar conquistas e tempo jogado. Sem login na Steam:
// a pessoa informa o perfil (que precisa mostrar os jogos publicamente) e o servidor consulta
// com a chave da instância.

/** SteamID64 de conta de usuário: 17 dígitos começando com 7656119. */
const STEAM_ID64 = /^7656119\d{10}$/;
/** URL personalizada (steamcommunity.com/id/<nome>): letras, números, _ e -. */
const VANITY = /^[\w-]{2,32}$/;

export type SteamProfileRef = { steamId: string } | { vanity: string };

/**
 * Lê o que a pessoa colou: SteamID64, URL do perfil (/profiles/<id> ou /id/<nome>) ou só o nome
 * da URL personalizada. null se não parecer nenhum deles.
 */
export function parseSteamProfile(input: string): SteamProfileRef | null {
  const text = input.trim();
  if (STEAM_ID64.test(text)) return { steamId: text };
  const url = text.match(/steamcommunity\.com\/(profiles|id)\/([^/?#\s]+)/i);
  if (url) {
    const [, kind, value = ""] = url;
    if (kind?.toLowerCase() === "profiles")
      return STEAM_ID64.test(value) ? { steamId: value } : null;
    return VANITY.test(value) ? { vanity: value } : null;
  }
  return VANITY.test(text) ? { vanity: text } : null;
}

export interface SteamProfile {
  steamId: string;
  name: string;
  avatarUrl: string | null;
  profileUrl: string;
  linkedAt: string;
}

export const linkSteamProfileSchema = z.object({
  profile: z
    .string()
    .trim()
    .min(1, "Informe o perfil da Steam")
    .max(200)
    .refine((value) => parseSteamProfile(value) !== null, {
      message: "Use a URL do perfil (steamcommunity.com/id/… ou /profiles/…) ou o SteamID64",
    }),
});
export type LinkSteamProfileInput = z.infer<typeof linkSteamProfileSchema>;

/** Resultado de sincronizar um jogo com a conta Steam. */
export interface SteamGameSync {
  gameId: number;
  name: string;
  /** App usado (null: o jogo não está na Steam pelo IGDB e não segue uma lista da Steam). */
  appId: number | null;
  /** O jogo está na conta Steam (as horas só vêm nesse caso). */
  owned: boolean;
  steamMinutes: number | null;
  /** Desbloqueios novos; os que já estavam marcados (à mão ou não) ficam como estavam. */
  newUnlocks: number;
  /** A lista da Steam foi ligada agora (o jogo ainda não seguia nenhuma lista). */
  linkedSet: boolean;
  /** Falha só neste jogo (a sincronização dos outros continua). */
  error: string | null;
}

export interface SteamLibrarySync {
  syncedAt: string;
  /** Só os jogos que estão na Steam (os outros são pulados). */
  games: SteamGameSync[];
  newUnlocks: number;
}

/** Intervalo mínimo entre duas sincronizações automáticas (ao abrir o app). */
export const STEAM_AUTO_SYNC_INTERVAL_MS = 30 * 60_000;

/** Estado da sincronização automática de um usuário. */
export interface SteamAutoSyncState {
  /** Início da última rodada (automática ou "Sincronizar tudo"). */
  lastRunAt: string;
  /** Falha da última rodada automática; some quando uma sincronização dá certo. */
  lastError: { message: string; at: string } | null;
}

/** Resultado de `POST /api/steam/sync/auto`. */
export interface SteamAutoSync {
  /** skipped: sem perfil, Steam desligada ou rodou há pouco. failed: ver `state.lastError`. */
  status: "skipped" | "synced" | "failed";
  /** Só os jogos em que algo pode ter mudado (os outros só tiveram as horas conferidas). */
  games: SteamGameSync[];
  newUnlocks: number;
  state: SteamAutoSyncState | null;
}

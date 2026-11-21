import { z } from "zod";
import { type GameStatus, gameStatusSchema } from "./domain";

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

// ---------------------------------------------------------------------------
// Importar a biblioteca da Steam: os jogos da conta que ainda não estão no Zerômetro.

/** Jogou nesses últimos dias: a importação sugere "Jogando"; senão, "Próximos". */
export const STEAM_IMPORT_RECENT_DAYS = 30;

/**
 * Status sugerido para um jogo que vem da Steam: "Jogando" se jogou nas últimas 2 semanas ou há
 * até STEAM_IMPORT_RECENT_DAYS dias. Muitos perfis não mandam a data, só as 2 semanas.
 */
export function suggestedImportStatus(
  game: { lastPlayedAt: string | null; recentMinutes: number },
  now: Date,
): GameStatus {
  if (game.recentMinutes > 0) return "playing";
  if (!game.lastPlayedAt) return "backlog";
  const days = (now.getTime() - Date.parse(game.lastPlayedAt)) / 86_400_000;
  return days <= STEAM_IMPORT_RECENT_DAYS ? "playing" : "backlog";
}

/** Um jogo da conta que pode entrar na biblioteca. */
export interface SteamImportCandidate {
  appId: number;
  igdbId: number;
  /** Nome no IGDB (o que fica na biblioteca). */
  name: string;
  /** Nome na Steam, quando é outro. */
  steamName: string | null;
  coverImageId: string | null;
  releaseYear: number | null;
  /** Tempo total na Steam. */
  minutes: number;
  /** Minutos nas últimas 2 semanas. */
  recentMinutes: number;
  lastPlayedAt: string | null;
  suggestedStatus: GameStatus;
  /** Ficou de fora numa importação anterior (não vem marcado). */
  ignored: boolean;
}

export interface SteamImportPreview {
  /** Mais jogados primeiro. */
  candidates: SteamImportCandidate[];
  /** Na conta, mas o IGDB não conhece o app (ferramentas, trilhas sonoras, alguns jogos). */
  unmatched: { appId: number; name: string | null; minutes: number }[];
  /** Jogos da conta que já estão na biblioteca. */
  inLibrary: number;
  /** A conta esconde o tempo de jogo (tudo 0): "os que têm horas" não ajuda a escolher. */
  hidesPlaytime: boolean;
}

const steamAppIdSchema = z.number().int().positive();

export const steamImportSchema = z.object({
  /** Os que entram, com o status de cada um (sem status: o sugerido, ver `suggestedImportStatus`). */
  games: z
    .array(z.object({ appId: steamAppIdSchema, status: gameStatusSchema.optional() }))
    .max(2000, "No máximo 2000 jogos por vez"),
  /** Os que ficaram desmarcados: não aparecem marcados da próxima vez. */
  ignore: z.array(steamAppIdSchema).max(20_000).default([]),
});
export type SteamImportInput = z.input<typeof steamImportSchema>;

export interface SteamImportResult {
  /** Entraram na biblioteca, com o tempo da Steam. Falta trazer as conquistas (`syncSteamGames`). */
  added: { gameId: number; appId: number; name: string; status: GameStatus }[];
  /** Não entraram, com o motivo (já estava, saiu da conta, o IGDB não achou). */
  skipped: { appId: number; reason: string }[];
  /** Quantos ficam ignorados agora. */
  ignored: number;
}

/** Jogos por pedido ao trazer as conquistas dos importados (o front pede em lotes). */
export const STEAM_SYNC_GAMES_BATCH = 10;

export const steamSyncGamesSchema = z.object({
  gameIds: z
    .array(z.number().int().positive())
    .min(1)
    .max(STEAM_SYNC_GAMES_BATCH * 5),
});

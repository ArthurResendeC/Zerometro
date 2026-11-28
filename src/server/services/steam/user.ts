import type { Env } from "../../env";
import {
  AchievementSourceNotConfiguredError,
  NotFoundError,
  SteamProfilePrivateError,
} from "../../errors";
import type { SteamProfileRef } from "../../../shared/steam";
import { createJsonClient, type FetchFn } from "../http-json";
import { createRequestGate, type RequestGate } from "../rate-gate";

// Dados da conta Steam de quem usa o app: perfil, conquistas desbloqueadas e horas por jogo.
// Tudo público (o perfil precisa mostrar os "Detalhes dos jogos"); a chave da instância faz as
// chamadas, sem login na Steam.

const BASE_URL = "https://api.steampowered.com/";
const VANITY_PATH = "ISteamUser/ResolveVanityURL/v1/";
const SUMMARIES_PATH = "ISteamUser/GetPlayerSummaries/v2/";
const PLAYER_ACHIEVEMENTS_PATH = "ISteamUserStats/GetPlayerAchievements/v1/";
const OWNED_GAMES_PATH = "IPlayerService/GetOwnedGames/v1/";
const MIN_INTERVAL_MS = 100;

export interface SteamPlayer {
  steamId: string;
  name: string;
  avatarUrl: string | null;
  profileUrl: string;
}

export interface SteamUnlock {
  /** apiname: o `externalId` da conquista na lista da Steam. */
  apiName: string;
  /** null quando a Steam não guardou a hora (conquistas muito antigas). */
  unlockedAt: Date | null;
}

export interface SteamOwnedGame {
  appId: number;
  /** O nome na Steam (null se ela não mandar). */
  name: string | null;
  /** Tempo total na Steam, em minutos. */
  minutes: number;
  /** Minutos nas últimas 2 semanas (vem mesmo quando a Steam não manda `lastPlayedAt`). */
  recentMinutes: number;
  lastPlayedAt: Date | null;
}

export interface SteamUserApi {
  readonly enabled: boolean;
  /** SteamID e nome do perfil. NotFoundError se a URL personalizada não existir. */
  resolveProfile(ref: SteamProfileRef): Promise<SteamPlayer>;
  /**
   * Conquistas que o jogador desbloqueou no app. null se a Steam não tiver dados dele nesse app
   * (sem conquistas, ou o jogo não está na conta). SteamProfilePrivateError se o perfil esconder.
   */
  getUnlocked(steamId: string, appId: number): Promise<SteamUnlock[] | null>;
  /** Jogos da conta com as horas (só os `appIds`, se vier). SteamProfilePrivateError se esconder. */
  getOwnedGames(steamId: string, appIds?: number[]): Promise<SteamOwnedGame[]>;
  /** Até quando a Steam pediu pausa (null = liberado): as rodadas automáticas esperam. */
  pausedUntil(): Date | null;
}

interface RawVanity {
  response?: { success?: number; steamid?: string };
}

interface RawSummaries {
  response?: {
    players?: { steamid: string; personaname?: string; profileurl?: string; avatarfull?: string }[];
  };
}

interface RawPlayerAchievements {
  playerstats?: {
    success?: boolean;
    error?: string;
    achievements?: { apiname: string; achieved: number; unlocktime?: number }[];
  };
}

interface RawOwnedGames {
  /** Vem vazio (`{}`) quando o perfil esconde os jogos. */
  response?: {
    game_count?: number;
    games?: {
      appid: number;
      name?: string;
      playtime_forever?: number;
      playtime_2weeks?: number;
      rtime_last_played?: number;
    }[];
  };
}

export interface SteamUserApiOptions {
  apiKey: string;
  fetch?: FetchFn;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  minIntervalMs?: number;
  /** A fila e o disjuntor da chave, compartilhados com as listas de conquistas. */
  gate?: RequestGate;
}

const fromUnix = (seconds: number | undefined) => (seconds ? new Date(seconds * 1000) : null);

export function createSteamUserApi(options: SteamUserApiOptions): SteamUserApi {
  const gate =
    options.gate ??
    createRequestGate({
      label: "a Steam",
      minIntervalMs: options.minIntervalMs ?? MIN_INTERVAL_MS,
      now: options.now,
      sleep: options.sleep,
    });
  const client = createJsonClient({
    label: "a Steam",
    baseUrl: BASE_URL,
    defaultParams: { key: options.apiKey },
    gate,
    fetch: options.fetch,
    now: options.now,
    sleep: options.sleep,
  });

  async function summary(steamId: string): Promise<SteamPlayer> {
    const raw = await client.get<RawSummaries>(SUMMARIES_PATH, { steamids: steamId });
    const player = raw.response?.players?.find((p) => p.steamid === steamId);
    if (!player) throw new NotFoundError(`Perfil da Steam ${steamId} não encontrado`);
    return {
      steamId,
      name: player.personaname?.trim() || steamId,
      avatarUrl: player.avatarfull || null,
      profileUrl: player.profileurl || `https://steamcommunity.com/profiles/${steamId}/`,
    };
  }

  return {
    enabled: true,
    pausedUntil: () => gate.pausedUntil(),

    async resolveProfile(ref) {
      if ("steamId" in ref) return summary(ref.steamId);
      const raw = await client.get<RawVanity>(VANITY_PATH, { vanityurl: ref.vanity });
      const steamId = raw.response?.success === 1 ? raw.response.steamid : undefined;
      if (!steamId) throw new NotFoundError(`Nenhum perfil da Steam em /id/${ref.vanity}`);
      return summary(steamId);
    },

    async getUnlocked(steamId, appId) {
      // 403 = perfil privado; 400 = app sem conquistas. A Steam explica no corpo.
      const raw = await client.get<RawPlayerAchievements>(
        PLAYER_ACHIEVEMENTS_PATH,
        { steamid: steamId, appid: appId },
        { acceptStatus: [400, 403] },
      );
      const stats = raw.playerstats;
      if (!stats?.success) {
        if (/not public/i.test(stats?.error ?? "")) throw new SteamProfilePrivateError();
        return null;
      }
      return (stats.achievements ?? [])
        .filter((a) => a.achieved === 1)
        .map((a) => ({ apiName: a.apiname, unlockedAt: fromUnix(a.unlocktime) }));
    },

    async getOwnedGames(steamId, appIds = []) {
      const filter = Object.fromEntries(appIds.map((id, i) => [`appids_filter[${i}]`, id]));
      const raw = await client.get<RawOwnedGames>(OWNED_GAMES_PATH, {
        steamid: steamId,
        include_appinfo: 1,
        include_played_free_games: 1,
        ...filter,
      });
      const response = raw.response;
      if (!response || response.game_count === undefined) throw new SteamProfilePrivateError();
      return (response.games ?? []).map((g) => ({
        appId: g.appid,
        name: g.name?.trim() || null,
        minutes: g.playtime_forever ?? 0,
        recentMinutes: g.playtime_2weeks ?? 0,
        lastPlayedAt: fromUnix(g.rtime_last_played),
      }));
    },
  };
}

const notConfigured = () =>
  Promise.reject(new AchievementSourceNotConfiguredError("Steam", "STEAM_WEB_API_KEY"));

/** Steam desligada (sem chave). */
export function createDisabledSteamUserApi(): SteamUserApi {
  return {
    enabled: false,
    resolveProfile: notConfigured,
    getUnlocked: notConfigured,
    getOwnedGames: notConfigured,
    pausedUntil: () => null,
  };
}

export function createSteamUserFromEnv(
  env: Pick<Env, "STEAM_WEB_API_KEY">,
  gate?: RequestGate,
): SteamUserApi {
  const apiKey = env.STEAM_WEB_API_KEY;
  return apiKey ? createSteamUserApi({ apiKey, gate }) : createDisabledSteamUserApi();
}

import type { Env } from "../../env";
import { AchievementSourceError, AchievementSourceNotConfiguredError } from "../../errors";
import type { AchievementSourceApi, FetchedAchievementSet } from "../achievement-sources";
import { createJsonClient, type FetchFn } from "../http-json";

// Steam Web API: a lista de conquistas de um app (GetSchemaForGame, precisa de chave) e a % de
// jogadores que desbloqueou cada uma (GetGlobalAchievementPercentagesForApp). Termos: a chave
// fica só no servidor, até 100 mil chamadas por dia, dados para uso pessoal de quem vê.

const BASE_URL = "https://api.steampowered.com/";
const SCHEMA_PATH = "ISteamUserStats/GetSchemaForGame/v2/";
const PERCENTAGES_PATH = "ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/";
/** Textos em português; o que o jogo não traduziu a Steam devolve no idioma padrão dele. */
const LANGUAGE = "brazilian";
/** 100 mil chamadas/dia dão mais de 1 por segundo; 10/s é folgado para o uso do app. */
const MIN_INTERVAL_MS = 100;

interface RawSchema {
  game?: {
    gameName?: string;
    availableGameStats?: {
      achievements?: {
        name: string;
        displayName?: string;
        description?: string;
        hidden?: number;
        icon?: string;
        icongray?: string;
      }[];
    };
  };
}

interface RawPercentages {
  achievementpercentages?: {
    /** A Steam já mandou `percent` como número e como texto. */
    achievements?: { name: string; percent: number | string }[];
  };
}

export interface SteamApiOptions {
  apiKey: string;
  fetch?: FetchFn;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  minIntervalMs?: number;
}

export function createSteamApi(options: SteamApiOptions): AchievementSourceApi {
  const client = createJsonClient({
    label: "a Steam",
    baseUrl: BASE_URL,
    defaultParams: { key: options.apiKey },
    minIntervalMs: options.minIntervalMs ?? MIN_INTERVAL_MS,
    fetch: options.fetch,
    now: options.now,
    sleep: options.sleep,
  });

  /** Raridade é enfeite: se a Steam falhar aqui, a lista sai sem ela. */
  async function fetchPercentages(appId: number): Promise<Map<string, number>> {
    try {
      const raw = await client.get<RawPercentages>(PERCENTAGES_PATH, { gameid: appId });
      const entries = raw.achievementpercentages?.achievements ?? [];
      return new Map(
        entries.flatMap(({ name, percent }) => {
          const value = Number(percent);
          return Number.isFinite(value) ? [[name, value] as const] : [];
        }),
      );
    } catch (error) {
      if (!(error instanceof AchievementSourceError)) throw error;
      console.warn(`Steam: sem raridade para o app ${appId}:`, error.message);
      return new Map();
    }
  }

  return {
    enabled: true,
    async getAchievementSet(appId) {
      const [schema, percentages] = await Promise.all([
        client.get<RawSchema>(SCHEMA_PATH, { appid: appId, l: LANGUAGE }),
        fetchPercentages(appId),
      ]);
      const list = schema.game?.availableGameStats?.achievements ?? [];
      if (list.length === 0) return null;

      return {
        source: "steam",
        externalId: String(appId),
        title: steamGameName(schema.game?.gameName),
        platform: null,
        achievements: list.map((a, index) => ({
          externalId: a.name,
          title: a.displayName?.trim() || a.name,
          description: a.description?.trim() || null,
          iconUrl: a.icon || null,
          iconLockedUrl: a.icongray || null,
          rarity: percentages.get(a.name) ?? null,
          points: null,
          hidden: a.hidden === 1,
          sortOrder: index,
        })),
      } satisfies FetchedAchievementSet;
    },
  };
}

/** O `gameName` do schema às vezes é interno ("ValveTestApp504230"); aí não serve. */
function steamGameName(name: string | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed && !/^ValveTestApp\d*$/i.test(trimmed) ? trimmed : null;
}

/** Steam desligada (sem chave): falha com uma mensagem clara. */
export function createDisabledSteamApi(): AchievementSourceApi {
  return {
    enabled: false,
    getAchievementSet() {
      return Promise.reject(new AchievementSourceNotConfiguredError("Steam", "STEAM_WEB_API_KEY"));
    },
  };
}

export function createSteamFromEnv(env: Pick<Env, "STEAM_WEB_API_KEY">): AchievementSourceApi {
  const apiKey = env.STEAM_WEB_API_KEY;
  if (!apiKey) {
    console.warn("STEAM_WEB_API_KEY ausente: conquistas da Steam desativadas.");
    return createDisabledSteamApi();
  }
  return createSteamApi({ apiKey });
}

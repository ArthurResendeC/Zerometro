import type { Env } from "../../env";
import { AchievementSourceNotConfiguredError } from "../../errors";
import type { AchievementSourceApi, FetchedAchievementSet } from "../achievement-sources";
import { createJsonClient, type FetchFn } from "../http-json";

// API do RetroAchievements: a lista de conquistas de um jogo (API_GetGameExtended) e os jogos
// de um console que têm conquistas (API_GetGameList, para achar o jogo pelo nome). Só
// metadados: nada de hashes, ROMs ou emuladores. Os dados mudam pouco e a API tem limite de
// requisições, então quem chama guarda em cache.

const BASE_URL = "https://retroachievements.org/API/";
const MEDIA_URL = "https://media.retroachievements.org";
/** Sem limite publicado: uma chamada a cada meio segundo, com folga. */
const MIN_INTERVAL_MS = 500;

interface RawGameExtended {
  ID?: number;
  Title?: string;
  ConsoleName?: string;
  NumDistinctPlayers?: number;
  NumDistinctPlayersCasual?: number;
  /** Objeto por id; vem `[]` quando o jogo não tem conquistas. */
  Achievements?:
    | Record<
        string,
        {
          ID: number;
          Title?: string;
          Description?: string;
          Points?: number;
          BadgeName?: string;
          DisplayOrder?: number;
          NumAwarded?: number;
        }
      >
    | [];
}

interface RawGameListEntry {
  ID: number;
  Title: string;
  ConsoleID: number;
  ConsoleName?: string;
  ImageIcon?: string;
  NumAchievements?: number;
  Points?: number;
}

/** Um jogo do RA na lista de um console. */
export interface RaGameListEntry {
  id: number;
  title: string;
  consoleId: number;
  consoleName: string | null;
  iconUrl: string | null;
  achievements: number;
  points: number;
}

export interface RetroAchievementsApi extends AchievementSourceApi {
  /** Jogos do console que têm conquistas oficiais (resposta grande: guardar em cache). */
  getGameList(consoleId: number): Promise<RaGameListEntry[]>;
}

export interface RetroAchievementsApiOptions {
  apiKey: string;
  fetch?: FetchFn;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  minIntervalMs?: number;
}

export function createRetroAchievementsApi(
  options: RetroAchievementsApiOptions,
): RetroAchievementsApi {
  const client = createJsonClient({
    label: "o RetroAchievements",
    baseUrl: BASE_URL,
    defaultParams: { y: options.apiKey },
    minIntervalMs: options.minIntervalMs ?? MIN_INTERVAL_MS,
    fetch: options.fetch,
    now: options.now,
    sleep: options.sleep,
  });

  return {
    enabled: true,

    async getAchievementSet(gameId) {
      const raw = await client.get<RawGameExtended | null>("API_GetGameExtended.php", {
        i: gameId,
      });
      if (!raw?.ID || !raw.Title || Array.isArray(raw.Achievements) || !raw.Achievements) {
        return null;
      }
      const players = raw.NumDistinctPlayers ?? raw.NumDistinctPlayersCasual ?? 0;
      const list = Object.values(raw.Achievements).toSorted(
        (a, b) => (a.DisplayOrder ?? 0) - (b.DisplayOrder ?? 0) || a.ID - b.ID,
      );
      if (list.length === 0) return null;

      return {
        source: "retroachievements",
        externalId: String(raw.ID),
        title: raw.Title,
        platform: raw.ConsoleName ?? null,
        achievements: list.map((a, index) => ({
          externalId: String(a.ID),
          title: a.Title?.trim() || `Conquista ${a.ID}`,
          description: a.Description?.trim() || null,
          iconUrl: a.BadgeName ? `${MEDIA_URL}/Badge/${a.BadgeName}.png` : null,
          iconLockedUrl: a.BadgeName ? `${MEDIA_URL}/Badge/${a.BadgeName}_lock.png` : null,
          rarity:
            players > 0 && a.NumAwarded !== undefined
              ? Math.min(100, (a.NumAwarded / players) * 100)
              : null,
          points: a.Points ?? null,
          hidden: false,
          sortOrder: index,
        })),
      } satisfies FetchedAchievementSet;
    },

    async getGameList(consoleId) {
      // f=1: só jogos com conquistas oficiais. Sem h=1, então sem hashes de ROM.
      const raw = await client.get<RawGameListEntry[] | null>("API_GetGameList.php", {
        i: consoleId,
        f: 1,
      });
      return (raw ?? []).map((g) => ({
        id: g.ID,
        title: g.Title,
        consoleId: g.ConsoleID,
        consoleName: g.ConsoleName ?? null,
        iconUrl: g.ImageIcon ? `${MEDIA_URL}${g.ImageIcon}` : null,
        achievements: g.NumAchievements ?? 0,
        points: g.Points ?? 0,
      }));
    },
  };
}

const notConfigured = () =>
  Promise.reject(new AchievementSourceNotConfiguredError("RetroAchievements", "RA_API_KEY"));

/** RA desligado (sem chave): falha com uma mensagem clara. */
export function createDisabledRetroAchievementsApi(): RetroAchievementsApi {
  return { enabled: false, getAchievementSet: notConfigured, getGameList: notConfigured };
}

export function createRetroAchievementsFromEnv(env: Pick<Env, "RA_API_KEY">): RetroAchievementsApi {
  const apiKey = env.RA_API_KEY;
  if (!apiKey) {
    console.warn("RA_API_KEY ausente: conquistas do RetroAchievements desativadas.");
    return createDisabledRetroAchievementsApi();
  }
  return createRetroAchievementsApi({ apiKey });
}

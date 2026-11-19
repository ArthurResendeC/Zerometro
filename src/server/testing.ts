// Helpers de teste compartilhados.
import { DEFAULT_TIME_ZONE } from "../shared/dates";
import type { IgdbGameDetails } from "../shared/igdb";
import { createApp } from "./app";
import { createTestDb, type Db } from "./db/client";
import type { Clock, ServiceContext } from "./services/context";
import type { IgdbApi } from "./services/igdb";

export function fakeIgdbGame(overrides: Partial<IgdbGameDetails> = {}): IgdbGameDetails {
  return {
    igdbId: 114283,
    name: "Persona 5 Royal",
    slug: "persona-5-royal",
    coverImageId: "coclf1",
    platforms: ["PS4", "PS5", "PC"],
    genres: ["Role-playing (RPG)"],
    releaseYear: 2019,
    gameType: "Versão expandida",
    timeToBeat: { mainSec: 315_000, extraSec: 424_580, completeSec: 799_200 },
    ...overrides,
  };
}

/** IGDB em memória: busca por substring no nome. */
export function createFakeIgdb(catalog: IgdbGameDetails[] = [fakeIgdbGame()]): IgdbApi & {
  calls: { getGame: number[] };
} {
  const calls = { getGame: [] as number[] };
  return {
    calls,
    async searchGames(term, limit = 10) {
      const needle = term.toLowerCase();
      return catalog
        .filter((g) => g.name.toLowerCase().includes(needle))
        .slice(0, limit)
        .map((game) => {
          const { timeToBeat: _ttb, ...summary } = game;
          return summary;
        });
    },
    async getGame(igdbId) {
      calls.getGame.push(igdbId);
      return catalog.find((g) => g.igdbId === igdbId) ?? null;
    },
  };
}

/** "Hoje" fixo nos testes (uma quinta-feira). */
export const TEST_TODAY = "2026-11-19";
/** "Agora" fixo: 15h de TEST_TODAY em São Paulo (UTC-3). */
export const TEST_NOW = new Date("2026-11-19T18:00:00.000Z");

/** Relógio controlável: `clock.set(...)` avança o tempo nos testes do timer. */
export function createTestClock(start: Date = TEST_NOW): Clock & { set: (date: Date) => void } {
  let current = start;
  return {
    now: () => current,
    timeZone: DEFAULT_TIME_ZONE,
    set: (date) => {
      current = date;
    },
  };
}

export function createTestApp(
  overrides: { db?: Db; igdb?: IgdbApi; clock?: ReturnType<typeof createTestClock> } = {},
) {
  const db = overrides.db ?? createTestDb();
  const igdb = overrides.igdb ?? createFakeIgdb();
  const clock = overrides.clock ?? createTestClock();
  return { app: createApp({ db, igdb, clock, logRequests: false }), db, igdb, clock };
}

export function createTestContext(overrides: Partial<ServiceContext> = {}): ServiceContext {
  return {
    db: overrides.db ?? createTestDb(),
    now: TEST_NOW,
    timeZone: DEFAULT_TIME_ZONE,
    today: TEST_TODAY,
    actor: "web",
    ...overrides,
  };
}

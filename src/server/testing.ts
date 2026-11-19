// Helpers de teste compartilhados.
import type { IgdbGameDetails } from "../shared/igdb";
import { createApp } from "./app";
import { createTestDb, type Db } from "./db/client";
import type { ServiceContext } from "./services/context";
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

/** "Hoje" fixo nos testes. */
export const TEST_TODAY = "2026-11-19";

export function createTestApp(overrides: { db?: Db; igdb?: IgdbApi; today?: string } = {}) {
  const db = overrides.db ?? createTestDb();
  const igdb = overrides.igdb ?? createFakeIgdb();
  const today = overrides.today ?? TEST_TODAY;
  return { app: createApp({ db, igdb, today: () => today, logRequests: false }), db, igdb };
}

export function createTestContext(overrides: Partial<ServiceContext> = {}): ServiceContext {
  return { db: overrides.db ?? createTestDb(), today: TEST_TODAY, actor: "web", ...overrides };
}

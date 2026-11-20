// Helpers de teste compartilhados.
import { DEFAULT_TIME_ZONE } from "../shared/dates";
import type { FeedGame, FeedKey } from "../shared/feeds";
import type { IgdbGamePage } from "../shared/game-page";
import type { IgdbGameDetails } from "../shared/igdb";
import { createApp } from "./app";
import { createRootRoutes } from "./mcp/routes";
import { createAuth, OWNER_ID, SESSION_COOKIE } from "./auth";
import { user } from "./db/schema";
import { createTestDb, type Db } from "./db/client";
import type { Clock, ServiceContext } from "./services/context";
import { createFeedsService } from "./services/feeds";
import { createGamePagesService } from "./services/game-pages";
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
    steamAppId: 1687950,
    ...overrides,
  };
}

export function fakeFeedGame(overrides: Partial<FeedGame> = {}): FeedGame {
  const { timeToBeat: _ttb, steamAppId: _steam, ...summary } = fakeIgdbGame();
  return {
    ...summary,
    criticRating: 92,
    criticRatingCount: 40,
    hypes: 120,
    releaseDate: "2019-10-31",
    releasePrecision: "day",
    ...overrides,
  };
}

/** Página do jogo com só o básico preenchido (como um jogo obscuro no IGDB). */
export function fakeGamePage(
  game: IgdbGameDetails = fakeIgdbGame(),
  overrides: Partial<IgdbGamePage> = {},
): IgdbGamePage {
  const { timeToBeat, steamAppId: _steam, ...summary } = game;
  return {
    ...fakeFeedGame(summary),
    summary: null,
    storyline: null,
    userRating: null,
    userRatingCount: 0,
    status: null,
    developers: [],
    publishers: [],
    themes: [],
    gameModes: [],
    perspectives: [],
    engines: [],
    releases: [],
    heroImageId: null,
    screenshotIds: [],
    videos: [],
    links: [],
    languages: [],
    ageRating: null,
    timeToBeat,
    timeToBeatCount: timeToBeat ? 10 : 0,
    parentGame: null,
    related: { expansions: [], dlcs: [], remakes: [], series: [], similar: [] },
    ...overrides,
  };
}

/** IGDB em memória: busca por substring no nome; listas da home fixas. */
export function createFakeIgdb(
  catalog: IgdbGameDetails[] = [fakeIgdbGame()],
  feeds: Partial<Record<FeedKey, FeedGame[]>> = {},
): IgdbApi & {
  calls: { getGame: number[]; getGamePage: number[]; getFeed: FeedKey[] };
} {
  const calls = { getGame: [] as number[], getGamePage: [] as number[], getFeed: [] as FeedKey[] };
  return {
    calls,
    async searchGames(term, limit = 10) {
      const needle = term.toLowerCase();
      return catalog
        .filter((g) => g.name.toLowerCase().includes(needle))
        .slice(0, limit)
        .map((game) => {
          const { timeToBeat: _ttb, steamAppId: _steam, ...summary } = game;
          return summary;
        });
    },
    async getGame(igdbId) {
      calls.getGame.push(igdbId);
      return catalog.find((g) => g.igdbId === igdbId) ?? null;
    },
    async getGamePage(igdbId) {
      calls.getGamePage.push(igdbId);
      const game = catalog.find((g) => g.igdbId === igdbId);
      return game ? fakeGamePage(game) : null;
    },
    async getFeed(key) {
      calls.getFeed.push(key);
      return feeds[key] ?? [];
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

// ---------------------------------------------------------------------------
// Usuários e login

/** Usuário padrão dos testes de service (o dono). */
export const TEST_USER_ID = "user-dono";
export const TEST_EMAILS = { owner: "dono@zerometro.test", friend: "amigo@zerometro.test" };
export const TEST_BASE_URL = "http://localhost:3000";

/** Cria (se ainda não existir) um usuário direto no banco. */
export function createTestUser(db: Db, id: string = TEST_USER_ID): string {
  const email = id === TEST_USER_ID ? TEST_EMAILS.owner : `${id}@zerometro.test`;
  db.insert(user).values({ id, name: id, email }).onConflictDoNothing().run();
  return id;
}

export function createTestContext(overrides: Partial<ServiceContext> = {}): ServiceContext {
  const db = overrides.db ?? createTestDb();
  const userId = createTestUser(db, overrides.userId);
  return {
    now: TEST_NOW,
    timeZone: DEFAULT_TIME_ZONE,
    today: TEST_TODAY,
    actor: "web",
    ...overrides,
    db,
    userId,
  };
}

/** Token da instância nos testes. */
export const TEST_TOKEN = "token-de-teste-com-mais-de-32-caracteres";

/**
 * App completo num banco em memória, com o token de teste. `request` já vai com o cookie de
 * sessão (como o site depois de entrar); `fetchRoot` roteia como o Bun.serve (MCP e OAuth na raiz).
 */
export async function createTestApp(
  overrides: { db?: Db; igdb?: IgdbApi; clock?: ReturnType<typeof createTestClock> } = {},
) {
  const db = overrides.db ?? createTestDb();
  const igdb = overrides.igdb ?? createFakeIgdb();
  const clock = overrides.clock ?? createTestClock();
  const auth = createAuth({
    token: TEST_TOKEN,
    publicUrl: TEST_BASE_URL,
    now: () => clock.now().getTime(),
    log: () => {},
  });
  const feeds = createFeedsService({ db, igdb, clock });
  const gamePages = createGamePagesService({ db, igdb, clock });
  const deps = { db, auth, igdb, feeds, gamePages, clock };
  const app = createApp({ ...deps, logRequests: false });
  const root = createRootRoutes(deps);
  /** Mesmo roteamento do Bun.serve (index.ts), sem a SPA. */
  const fetchRoot = async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request ? input : new Request(new URL(input, TEST_BASE_URL), init);
    const { pathname } = new URL(request.url);
    if (pathname === "/mcp") return root.mcp(request);
    const oauth = root.oauth[pathname];
    if (oauth) {
      const handler = oauth[request.method as "GET" | "POST"];
      return handler ? handler(request) : new Response(null, { status: 405 });
    }
    return app.fetch(request);
  };

  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: TEST_TOKEN }),
  });
  const cookie = sessionCookie(login) ?? "";
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", cookie);
    return app.request(path, { ...init, headers });
  };

  return {
    app,
    fetchRoot,
    db,
    igdb,
    feeds,
    gamePages,
    clock,
    auth,
    cookie,
    userId: OWNER_ID,
    request,
  };
}

/** `nome=valor` do cookie de sessão que a resposta define, se definir. */
export function sessionCookie(res: Response): string | undefined {
  return res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.split(";")[0];
}

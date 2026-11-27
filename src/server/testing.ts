// Helpers de teste compartilhados.
import { DEFAULT_TIME_ZONE } from "../shared/dates";
import { createRecapImageRenderer, type RecapImageRenderer } from "./services/recap-image";
import type { FeedGame, FeedKey } from "../shared/feeds";
import type { IgdbGamePage } from "../shared/game-page";
import { type IgdbGameDetails, toGameSummary } from "../shared/igdb";
import { createApp } from "./app";
import { createRootRoutes } from "./mcp/routes";
import { createAuth, OWNER_ID, SESSION_COOKIE } from "./auth";
import { user } from "./db/schema";
import { createTestDb, type Db } from "./db/client";
import type { Clock, ServiceContext } from "./services/context";
import { createFeedsService } from "./services/feeds";
import { createGamePagesService } from "./services/game-pages";
import type { IgdbApi } from "./services/igdb";
import type { AchievementSourceApi, FetchedAchievementSet } from "./services/achievement-sources";
import { createAchievementCatalog } from "./services/achievement-catalog";
import type { RaGameListEntry, RetroAchievementsApi } from "./services/retroachievements";
import type { SteamOwnedGame, SteamUnlock, SteamUserApi } from "./services/steam/user";
import { NotFoundError, SteamProfilePrivateError } from "./errors";
import { createRating } from "./services/ratings";

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
    themes: ["Fantasy", "Drama"],
    gameModes: ["Single player"],
    perspectives: ["Third person"],
    companies: [
      { igdbId: 1128, name: "Atlus", developer: true, publisher: true },
      { igdbId: 112, name: "Sega", developer: false, publisher: true },
    ],
    collections: [{ igdbId: 456, name: "Persona" }],
    franchises: [{ igdbId: 789, name: "Megami Tensei" }],
    ...overrides,
  };
}

export function fakeFeedGame(overrides: Partial<FeedGame> = {}): FeedGame {
  return {
    ...toGameSummary(fakeIgdbGame()),
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
  calls: {
    getGame: number[];
    getGames: number[][];
    findBySteamAppIds: number[][];
    getGamePage: number[];
    getFeed: FeedKey[];
  };
} {
  const calls = {
    getGame: [] as number[],
    getGames: [] as number[][],
    findBySteamAppIds: [] as number[][],
    getGamePage: [] as number[],
    getFeed: [] as FeedKey[],
  };
  return {
    calls,
    async searchGames(term, limit = 10) {
      const needle = term.toLowerCase();
      return catalog
        .filter((g) => g.name.toLowerCase().includes(needle))
        .slice(0, limit)
        .map(toGameSummary);
    },
    async getGame(igdbId) {
      calls.getGame.push(igdbId);
      return catalog.find((g) => g.igdbId === igdbId) ?? null;
    },
    async getGames(igdbIds) {
      calls.getGames.push(igdbIds);
      return catalog.filter((g) => igdbIds.includes(g.igdbId));
    },
    async findBySteamAppIds(appIds) {
      calls.findBySteamAppIds.push(appIds);
      return new Map(
        catalog.flatMap(({ timeToBeat: _ttb, steamAppId, ...summary }) =>
          steamAppId !== null && appIds.includes(steamAppId)
            ? [[steamAppId, summary] as const]
            : [],
        ),
      );
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

// ---------------------------------------------------------------------------
// Conquistas

/** Lista da Steam com 3 conquistas (a última secreta), como a do P5R do `fakeIgdbGame`. */
export function fakeSteamSet(
  overrides: Partial<FetchedAchievementSet> = {},
): FetchedAchievementSet {
  return {
    source: "steam",
    externalId: "1687950",
    title: "Persona 5 Royal",
    platform: null,
    achievements: [
      { externalId: "ACH_1", title: "Primeiro palácio", rarity: 80 },
      { externalId: "ACH_2", title: "Confidente máximo", rarity: 30 },
      { externalId: "ACH_3", title: "Final verdadeiro", rarity: 8, hidden: true },
    ].map((a, sortOrder) =>
      Object.assign(
        {
          description: null,
          iconUrl: `https://cdn.steam/${a.externalId}.jpg`,
          iconLockedUrl: `https://cdn.steam/${a.externalId}_gray.jpg`,
          points: null,
          hidden: false,
          sortOrder,
        },
        a,
      ),
    ),
    ...overrides,
  };
}

/** Lista do RA (Super Metroid, 2 conquistas com pontos). */
export function fakeRaSet(overrides: Partial<FetchedAchievementSet> = {}): FetchedAchievementSet {
  return {
    source: "retroachievements",
    externalId: "1446",
    title: "Super Metroid",
    platform: "SNES/Super Famicom",
    achievements: [
      { externalId: "8", title: "Morph Ball", points: 5, rarity: 90 },
      { externalId: "9", title: "Kraid", points: 10, rarity: 25 },
    ].map((a, sortOrder) =>
      Object.assign(
        { description: null, iconUrl: null, iconLockedUrl: null, hidden: false, sortOrder },
        a,
      ),
    ),
    ...overrides,
  };
}

export function fakeRaGame(overrides: Partial<RaGameListEntry> = {}): RaGameListEntry {
  return {
    id: 1446,
    title: "Super Metroid",
    consoleId: 3,
    consoleName: "SNES/Super Famicom",
    iconUrl: null,
    achievements: 2,
    points: 15,
    ...overrides,
  };
}

/** Fonte em memória: devolve a lista pelo id (cópia), ou falha com `failWith`. */
export function createFakeSource(
  sets: FetchedAchievementSet[],
  options: { enabled?: boolean; failWith?: Error } = {},
): AchievementSourceApi & { calls: number[]; sets: FetchedAchievementSet[] } {
  const calls: number[] = [];
  return {
    enabled: options.enabled ?? true,
    calls,
    sets,
    async getAchievementSet(id) {
      calls.push(id);
      if (options.failWith) throw options.failWith;
      return structuredClone(sets.find((s) => s.externalId === String(id)) ?? null);
    },
  };
}

export function createFakeRa(
  sets: FetchedAchievementSet[] = [fakeRaSet()],
  lists: Record<number, RaGameListEntry[]> = { 3: [fakeRaGame()] },
  options: { enabled?: boolean; failWith?: Error } = {},
): RetroAchievementsApi & ReturnType<typeof createFakeSource> & { listCalls: number[] } {
  const listCalls: number[] = [];
  return {
    ...createFakeSource(sets, options),
    listCalls,
    async getGameList(consoleId) {
      listCalls.push(consoleId);
      if (options.failWith) throw options.failWith;
      return lists[consoleId] ?? [];
    },
  };
}

/** SteamID do perfil falso. */
export const FAKE_STEAM_ID = "76561197960435530";

/**
 * Conta Steam falsa: o perfil "robinwalker", os jogos `owned` (appid → minutos) e os desbloqueios
 * de cada app. `private: true` simula o perfil que esconde os jogos.
 */
export function createFakeSteamUser(
  options: {
    /** Minutos por app, ou os minutos, quando jogou por último e o nome. Lido a cada chamada. */
    owned?: Record<
      number,
      | number
      | { minutes: number; lastPlayedAt: Date | null; name?: string | null; recentMinutes?: number }
    >;
    unlocked?: Record<number, SteamUnlock[]>;
    private?: boolean;
    enabled?: boolean;
  } = {},
): SteamUserApi & { calls: string[] } {
  const calls: string[] = [];
  const games = (): SteamOwnedGame[] =>
    Object.entries(options.owned ?? {}).map(([appId, game]) =>
      typeof game === "number"
        ? { appId: Number(appId), name: null, minutes: game, recentMinutes: 0, lastPlayedAt: null }
        : {
            appId: Number(appId),
            name: game.name ?? null,
            minutes: game.minutes,
            recentMinutes: game.recentMinutes ?? 0,
            lastPlayedAt: game.lastPlayedAt,
          },
    );
  return {
    enabled: options.enabled ?? true,
    calls,
    async resolveProfile(ref) {
      calls.push(`resolve:${"steamId" in ref ? ref.steamId : ref.vanity}`);
      const known = "steamId" in ref ? ref.steamId === FAKE_STEAM_ID : ref.vanity === "robinwalker";
      if (!known) throw new NotFoundError("Perfil da Steam não encontrado");
      return {
        steamId: FAKE_STEAM_ID,
        name: "Robin",
        avatarUrl: "https://avatars.steamstatic.com/robin_full.jpg",
        profileUrl: "https://steamcommunity.com/id/robinwalker/",
      };
    },
    async getUnlocked(_steamId, appId) {
      calls.push(`unlocked:${appId}`);
      if (options.private) throw new SteamProfilePrivateError();
      return options.unlocked?.[appId] ?? null;
    },
    async getOwnedGames(_steamId, appIds = []) {
      calls.push(`owned:${appIds.join(",")}`);
      if (options.private) throw new SteamProfilePrivateError();
      return appIds.length > 0 ? games().filter((g) => appIds.includes(g.appId)) : games();
    },
  };
}

export function createTestCatalog(
  db: Db,
  clock: Pick<Clock, "now"> = createTestClock(),
  sources: { steam?: AchievementSourceApi; retroachievements?: RetroAchievementsApi } = {},
) {
  const steam = sources.steam ?? createFakeSource([fakeSteamSet()]);
  const retroachievements = sources.retroachievements ?? createFakeRa();
  return createAchievementCatalog({ db, clock, steam, retroachievements, onError: () => {} });
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

/** Avalia um jogo só com a nota de coração (a "nota rápida"), para testes que só precisam da nota. */
export function rateGut(ctx: ServiceContext, gameId: number, enjoyment: number) {
  return createRating(ctx, gameId, { scores: {}, enjoyment, preset: "default", mode: "gut" });
}

/** Token da instância nos testes. */
export const TEST_TOKEN = "token-de-teste-com-mais-de-32-caracteres";

/**
 * App completo num banco em memória, com o token de teste. `request` já vai com o cookie de
 * sessão (como o site depois de entrar); `fetchRoot` roteia como o Bun.serve (MCP e OAuth na raiz).
 */
export async function createTestApp(
  overrides: {
    db?: Db;
    igdb?: IgdbApi;
    clock?: ReturnType<typeof createTestClock>;
    steam?: AchievementSourceApi;
    retroachievements?: RetroAchievementsApi;
    steamUser?: SteamUserApi;
    recapImages?: RecapImageRenderer;
  } = {},
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
  const achievements = createTestCatalog(db, clock, overrides);
  const steamUser = overrides.steamUser ?? createFakeSteamUser();
  // Sem rede nos testes: as capas não carregam e entram as iniciais.
  const recapImages =
    overrides.recapImages ??
    createRecapImageRenderer({ fetch: async () => new Response(null, { status: 404 }) });
  const deps = { db, auth, igdb, feeds, gamePages, achievements, steamUser, recapImages, clock };
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
    achievements,
    steamUser,
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

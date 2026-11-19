// Helpers de teste compartilhados.
import { spyOn } from "bun:test";
import { DEFAULT_TIME_ZONE } from "../shared/dates";
import type { FeedGame, FeedKey } from "../shared/feeds";
import type { IgdbGameDetails } from "../shared/igdb";
import { testUtils, type TestHelpers } from "better-auth/plugins";
import { createApp } from "./app";
import { createRootRoutes } from "./mcp/routes";
import { createAuth, createAuthGateway } from "./auth";
import { user } from "./db/schema";
import { createTestDb, type Db } from "./db/client";
import type { Clock, ServiceContext } from "./services/context";
import { createFeedsService } from "./services/feeds";
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

export function fakeFeedGame(overrides: Partial<FeedGame> = {}): FeedGame {
  const { timeToBeat: _ttb, ...summary } = fakeIgdbGame();
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

/** IGDB em memória: busca por substring no nome; listas da home fixas. */
export function createFakeIgdb(
  catalog: IgdbGameDetails[] = [fakeIgdbGame()],
  feeds: Partial<Record<FeedKey, FeedGame[]>> = {},
): IgdbApi & {
  calls: { getGame: number[]; getFeed: FeedKey[] };
} {
  const calls = { getGame: [] as number[], getFeed: [] as FeedKey[] };
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
export const TEST_AUTH_SECRET = "segredo-de-teste-com-mais-de-32-caracteres";

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

/**
 * App completo com Better Auth de verdade (plugin testUtils) num banco em memória.
 * `request` já vai logado como o dono; `loginAs` cria e loga outro convidado.
 */
export async function createTestApp(
  overrides: { db?: Db; igdb?: IgdbApi; clock?: ReturnType<typeof createTestClock> } = {},
) {
  const db = overrides.db ?? createTestDb();
  const igdb = overrides.igdb ?? createFakeIgdb();
  const clock = overrides.clock ?? createTestClock();
  const allowedEmails = [TEST_EMAILS.owner, TEST_EMAILS.friend];
  const auth = createAuth({
    db,
    secret: TEST_AUTH_SECRET,
    baseURL: TEST_BASE_URL,
    google: { clientId: "test-client-id", clientSecret: "test-client-secret" },
    allowedEmails,
    plugins: [testUtils()],
  });
  const feeds = createFeedsService({ db, igdb, clock });
  const deps = { db, auth: createAuthGateway(auth, allowedEmails), igdb, feeds, clock };
  const app = createApp({ ...deps, logRequests: false });
  const root = createRootRoutes(deps);
  /** Mesmo roteamento do Bun.serve (index.ts), sem a SPA. */
  const fetchRoot = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request =
      input instanceof Request ? input : new Request(new URL(input, TEST_BASE_URL), init);
    const { pathname } = new URL(request.url);
    if (pathname === "/mcp") return root.mcp(request);
    if (pathname.startsWith("/.well-known/")) return root.wellKnown(request);
    return Promise.resolve(app.fetch(request));
  };
  const helpers = ((await auth.$context) as unknown as { test: TestHelpers }).test;

  async function loginAs(email: string) {
    const created = await helpers.saveUser(helpers.createUser({ email, name: email }));
    const { headers } = await helpers.login({ userId: created.id });
    const request = (path: string, init: RequestInit = {}) => {
      const merged = new Headers(init.headers);
      for (const [key, value] of headers) merged.set(key, value);
      return app.request(path, { ...init, headers: merged });
    };
    return { userId: created.id, headers, request };
  }

  const owner = await loginAs(TEST_EMAILS.owner);
  return {
    app,
    fetchRoot,
    db,
    igdb,
    feeds,
    clock,
    auth,
    helpers,
    loginAs,
    userId: owner.userId,
    request: owner.request,
  };
}

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/**
 * Login com Google simulado: o endpoint de token do Google devolve um id_token montado aqui
 * (no fluxo com code, a Better Auth só decodifica o id_token). Devolve a função que desfaz.
 */
export function mockGoogleLogin(email: string): () => void {
  const idToken = [
    b64({ alg: "none", typ: "JWT" }),
    b64({ sub: `google-${email}`, email, email_verified: true, name: "Fulano", picture: null }),
    "",
  ].join(".");
  const realFetch = globalThis.fetch;
  const spy = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return Response.json({
        access_token: "at",
        id_token: idToken,
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    return realFetch(input, init);
  }) as typeof fetch);
  return () => spy.mockRestore();
}

import { and, eq, inArray } from "drizzle-orm";
import type { LibraryItem } from "../../shared/library";
import {
  STEAM_AUTO_SYNC_INTERVAL_MS,
  type SteamAutoSync,
  type SteamGameSync,
  type SteamLibrarySync,
  type SteamLibrarySyncRun,
  type SteamProfile,
} from "../../shared/steam";
import type { AchievementSet } from "../db/schema";
import {
  achievementUnlocks,
  achievements,
  libraryEntries,
  userAchievementSets,
} from "../db/schema";
import {
  AppError,
  SourceRateLimitedError,
  SteamNotLinkedError,
  SteamProfilePrivateError,
} from "../errors";
import type { AchievementCatalog } from "./achievement-catalog";
import { ensureSetOrNull, linkedSets, steamAppIdOf } from "./achievements";
import { logActivity } from "./activity";
import type { ServiceContext } from "./context";
import type { IgdbApi } from "./igdb";
import { getLibraryItem, listLibrary } from "./library";
import { getAutoSyncState, getSteamProfile, setAutoSyncState } from "./steam-account";
import { countSteamPlaytime } from "./steam-playtime";
import type { SteamOwnedGame, SteamUserApi } from "./steam/user";

// Sincronização com a conta Steam: traz as conquistas desbloqueadas (com a data real) e o tempo
// total de cada jogo. Só adiciona desbloqueios, nunca desmarca os manuais. O tempo da Steam fica
// guardado à parte; ele só vale como "tempo jogado" se o jogo usar a Steam como fonte, e aí o
// que foi jogado desde a última sincronização vira sessão (ver `steam-playtime.ts`).
//
// Manual: o botão no jogo (na hora) ou "Sincronizar tudo" (em segundo plano, ver
// `startSteamLibrarySync`). Automática (ao abrir o app e o job do servidor): no máximo a cada
// STEAM_AUTO_SYNC_INTERVAL_MS e incremental, só nos jogos que mudaram.
//
// Limite da Steam: as chamadas passam pela fila da chave (`rate-gate.ts`). Se a Steam pedir pausa,
// a rodada para na hora (SourceRateLimitedError) em vez de seguir tentando jogo a jogo.

/** Erros que valem para todos os jogos: não adianta continuar a rodada. */
const stopsTheRound = (error: unknown) =>
  error instanceof SteamProfilePrivateError ||
  error instanceof SourceRateLimitedError ||
  !(error instanceof AppError);

export interface SteamSyncDeps {
  catalog: AchievementCatalog;
  igdb: IgdbApi;
  steamUser: SteamUserApi;
}

export function requireSteamProfile(ctx: ServiceContext): SteamProfile {
  const profile = getSteamProfile(ctx);
  if (!profile) throw new SteamNotLinkedError();
  return profile;
}

/** Sincroniza um jogo da biblioteca. */
export async function syncSteamGame(
  ctx: ServiceContext,
  deps: SteamSyncDeps,
  gameId: number,
): Promise<SteamGameSync> {
  const profile = requireSteamProfile(ctx);
  const item = getLibraryItem(ctx, gameId);
  const result = await syncOne(ctx, deps, profile, item, await locate(ctx, deps, item), null);
  logSync(ctx, [result]);
  // Deu certo: um erro antigo da automática (ex.: perfil privado) não vale mais.
  const state = getAutoSyncState(ctx);
  if (state?.lastError) setAutoSyncState(ctx, { ...state, lastError: null });
  return result;
}

/**
 * Sincroniza todos os jogos da biblioteca que estão na Steam, um de cada vez. Com `gameIds`, só
 * esses (as conquistas dos que acabaram de ser importados, em lotes) e sem mexer no relógio da
 * sincronização automática.
 */
export async function syncSteamLibrary(
  ctx: ServiceContext,
  deps: SteamSyncDeps,
  options: { gameIds?: number[]; onProgress?: (done: number, total: number) => void } = {},
): Promise<SteamLibrarySync> {
  const profile = requireSteamProfile(ctx);
  const owned = new Map(
    (await deps.steamUser.getOwnedGames(profile.steamId)).map((g) => [g.appId, g]),
  );
  const only = options.gameIds && new Set(options.gameIds);
  const items = listLibrary(ctx).filter((item) => !only || only.has(item.gameId));
  const games: SteamGameSync[] = [];
  options.onProgress?.(0, items.length);
  for (const [index, item] of items.entries()) {
    try {
      // Um de cada vez, de propósito: a Steam e o IGDB têm limite de requisições.
      // oxlint-disable-next-line no-await-in-loop
      const result = await syncOne(ctx, deps, profile, item, await locate(ctx, deps, item), owned);
      if (result.appId !== null) games.push(result);
    } catch (error) {
      // Perfil privado ou a Steam pedindo pausa valem para todos os jogos.
      if (stopsTheRound(error)) throw error;
      games.push({ ...emptyResult(item), error: (error as AppError).message });
    }
    options.onProgress?.(index + 1, items.length);
  }
  logSync(ctx, games);
  // Acabou de passar por tudo: a automática não precisa rodar logo em seguida.
  if (!only) setAutoSyncState(ctx, { lastRunAt: ctx.now.toISOString(), lastError: null });
  return {
    syncedAt: ctx.now.toISOString(),
    games,
    newUnlocks: games.reduce((sum, g) => sum + g.newUnlocks, 0),
  };
}

const emptyResult = (item: { gameId: number; name: string }): SteamGameSync => ({
  gameId: item.gameId,
  name: item.name,
  appId: null,
  owned: false,
  steamMinutes: null,
  newUnlocks: 0,
  sessionMinutes: 0,
  linkedSet: false,
  error: null,
});

interface Located {
  sets: AchievementSet[];
  steamSet: AchievementSet | null;
  /** null: o jogo não está na Steam pelo IGDB e não segue uma lista da Steam. */
  appId: number | null;
}

/** O app do jogo na Steam: o da lista da Steam ligada ou o do IGDB. */
async function locate(
  ctx: ServiceContext,
  deps: SteamSyncDeps,
  item: { gameId: number },
): Promise<Located> {
  const sets = linkedSets(ctx, item.gameId);
  const steamSet = sets.find((s) => s.source === "steam") ?? null;
  const appId = steamSet
    ? Number(steamSet.externalId)
    : await steamAppIdOf(ctx, deps.igdb, item.gameId);
  return { sets, steamSet, appId: appId || null };
}

/**
 * Um jogo: as horas (se está na conta) e os desbloqueios. `owned` é a conta inteira
 * (sincronizar tudo) ou null (busca só este app).
 */
async function syncOne(
  ctx: ServiceContext,
  deps: SteamSyncDeps,
  profile: SteamProfile,
  item: { gameId: number; name: string },
  { sets, steamSet: linkedSteamSet, appId }: Located,
  owned: Map<number, SteamOwnedGame> | null,
): Promise<SteamGameSync> {
  const result = emptyResult(item);
  let steamSet = linkedSteamSet;
  if (!appId) return result;
  result.appId = appId;

  const game = owned
    ? owned.get(appId)
    : (await deps.steamUser.getOwnedGames(profile.steamId, [appId]))[0];
  result.owned = Boolean(game);
  result.steamMinutes = game?.minutes ?? null;

  // Jogo na conta que ainda não segue lista nenhuma: liga a da Steam.
  if (!steamSet && game && sets.length === 0 && deps.catalog.enabled.steam) {
    steamSet = await ensureSetOrNull(deps.catalog, "steam", String(appId));
    if (steamSet) {
      ctx.db
        .insert(userAchievementSets)
        .values({ userId: ctx.userId, gameId: item.gameId, setId: steamSet.id })
        .onConflictDoNothing()
        .run();
      result.linkedSet = true;
    }
  }

  // Sem o jogo na conta, a Steam pode não ter dados; só pergunta se já segue a lista.
  const unlocked = steamSet ? await unlockedOf(deps, profile, appId, Boolean(game)) : null;
  ctx.db.transaction((tx) => {
    if (steamSet && unlocked && unlocked.length > 0) {
      const ids = new Map(
        tx
          .select({ id: achievements.id, externalId: achievements.externalId })
          .from(achievements)
          .where(
            and(
              eq(achievements.setId, steamSet.id),
              inArray(
                achievements.externalId,
                unlocked.map((u) => u.apiName),
              ),
            ),
          )
          .all()
          .map((a) => [a.externalId, a.id]),
      );
      const rows = unlocked.flatMap((u) => {
        const achievementId = ids.get(u.apiName);
        if (achievementId === undefined) return [];
        const unlockedAt = (u.unlockedAt ?? ctx.now).toISOString();
        return [{ userId: ctx.userId, achievementId, unlockedAt, origin: "sync" as const }];
      });
      if (rows.length > 0) {
        result.newUnlocks = tx
          .insert(achievementUnlocks)
          .values(rows)
          .onConflictDoNothing()
          .returning({ id: achievementUnlocks.id })
          .all().length;
      }
    }
    tx.update(libraryEntries)
      .set({ steamMinutes: result.steamMinutes, steamSyncedAt: ctx.now.toISOString() })
      .where(and(eq(libraryEntries.userId, ctx.userId), eq(libraryEntries.gameId, item.gameId)))
      .run();
    if (game) result.sessionMinutes = countSteamPlaytime(tx, ctx, item.gameId, game).minutes;
  });
  return result;
}

/**
 * Os desbloqueios do jogador no app. Num app fora da conta (outra plataforma, a lista ligada à
 * mão), a Steam responde "Profile is not public" mesmo com o perfil público: a lista de jogos da
 * conta já veio, então ali é só "sem dados desse jogo", e a rodada segue.
 */
async function unlockedOf(
  deps: SteamSyncDeps,
  profile: SteamProfile,
  appId: number,
  owned: boolean,
) {
  try {
    return await deps.steamUser.getUnlocked(profile.steamId, appId);
  } catch (error) {
    if (!owned && error instanceof SteamProfilePrivateError) return null;
    throw error;
  }
}

/**
 * Rodada automática (ao abrir o app e o job do servidor). Pula se não há perfil ou se rodou há
 * menos de `minIntervalMs` (padrão STEAM_AUTO_SYNC_INTERVAL_MS). Uma chamada traz as horas da conta inteira; as conquistas só são
 * buscadas nos jogos que mudaram (ver `changedSinceSync`). Erros não estouram: ficam no estado.
 */
export async function autoSyncSteam(
  ctx: ServiceContext,
  deps: SteamSyncDeps,
  { minIntervalMs = STEAM_AUTO_SYNC_INTERVAL_MS }: { minIntervalMs?: number } = {},
): Promise<SteamAutoSync> {
  const previous = getAutoSyncState(ctx);
  const profile = deps.steamUser.enabled ? getSteamProfile(ctx) : null;
  const skipped: SteamAutoSync = { status: "skipped", games: [], newUnlocks: 0, state: previous };
  if (!profile) return skipped;
  // A Steam pediu pausa: nem chama, e o relógio não anda (roda de novo depois da pausa). Com o
  // "Sincronizar tudo" rodando para este perfil, também não há o que fazer agora.
  if (deps.steamUser.pausedUntil() || getSteamLibrarySyncRun(ctx)?.status === "running") {
    return skipped;
  }
  const elapsed = previous ? ctx.now.getTime() - Date.parse(previous.lastRunAt) : Infinity;
  if (elapsed >= 0 && elapsed < minIntervalMs) return skipped;

  // Gravado antes do primeiro await: outra aba ou aparelho que abrir agora já vê e pula.
  const lastRunAt = ctx.now.toISOString();
  setAutoSyncState(ctx, { lastRunAt, lastError: previous?.lastError ?? null });

  const games: SteamGameSync[] = [];
  try {
    const account = await deps.steamUser.getOwnedGames(profile.steamId);
    const owned = new Map(account.map((g) => [g.appId, g]));
    // "Sempre manter meu tempo total de jogo privado": tudo 0 e sem data, não dá para comparar.
    const hidesPlaytime = account.every((g) => g.minutes === 0 && g.lastPlayedAt === null);
    const unchanged: { gameId: number; game: SteamOwnedGame }[] = [];
    for (const item of listLibrary(ctx)) {
      try {
        // oxlint-disable-next-line no-await-in-loop
        const located = await locate(ctx, deps, item);
        const game = located.appId ? owned.get(located.appId) : undefined;
        // Fora da conta (ou fora da Steam): nada muda sozinho; o botão do jogo continua lá.
        if (!game) continue;
        if (!changedSinceSync(item, game, hidesPlaytime)) {
          unchanged.push({ gameId: item.gameId, game });
          continue;
        }
        // oxlint-disable-next-line no-await-in-loop
        games.push(await syncOne(ctx, deps, profile, item, located, owned));
      } catch (error) {
        if (stopsTheRound(error)) throw error;
        games.push({ ...emptyResult(item), error: (error as AppError).message });
      }
    }
    // As horas desses foram conferidas agora, mesmo sem mudar (e a base das sessões avança).
    if (unchanged.length > 0) {
      ctx.db.transaction((tx) => {
        tx.update(libraryEntries)
          .set({ steamSyncedAt: lastRunAt })
          .where(
            and(
              eq(libraryEntries.userId, ctx.userId),
              inArray(
                libraryEntries.gameId,
                unchanged.map((u) => u.gameId),
              ),
            ),
          )
          .run();
        for (const { gameId, game } of unchanged) countSteamPlaytime(tx, ctx, gameId, game);
      });
    }
  } catch (error) {
    const message =
      error instanceof AppError ? error.message : "Não foi possível falar com a Steam";
    if (!(error instanceof AppError)) console.error("Sincronização automática da Steam:", error);
    const state = { lastRunAt, lastError: { message, at: lastRunAt } };
    setAutoSyncState(ctx, state);
    return { status: "failed", games, newUnlocks: 0, state };
  }

  if (games.length > 0) logSync(ctx, games, { auto: true });
  const state = { lastRunAt, lastError: null };
  setAutoSyncState(ctx, state);
  return {
    status: "synced",
    games,
    newUnlocks: games.reduce((sum, g) => sum + g.newUnlocks, 0),
    state,
  };
}

/**
 * Vale buscar as conquistas de novo? Sem jogar, elas não mudam, e jogar muda as horas (ou a data
 * em que jogou por último). Quem esconde o tempo de jogo na Steam: só os jogos "jogando" e
 * "sem fim".
 */
export function changedSinceSync(
  item: Pick<LibraryItem, "status" | "steamPlaytime">,
  game: SteamOwnedGame,
  hidesPlaytime: boolean,
): boolean {
  const last = item.steamPlaytime;
  if (!last) return true;
  if (hidesPlaytime) return item.status === "playing" || item.status === "endless";
  if (game.minutes !== last.minutes) return true;
  return game.lastPlayedAt !== null && game.lastPlayedAt.getTime() > Date.parse(last.syncedAt);
}

function logSync(ctx: ServiceContext, games: SteamGameSync[], extra: { auto?: true } = {}) {
  logActivity(ctx.db, ctx, "steam.sync", {
    ...extra,
    games: games.map((g) => ({
      gameId: g.gameId,
      appId: g.appId,
      minutes: g.steamMinutes,
      newUnlocks: g.newUnlocks,
      ...(g.sessionMinutes && { sessionMinutes: g.sessionMinutes }),
      ...(g.linkedSet && { linkedSet: true }),
      ...(g.error && { error: g.error }),
    })),
  });
}

// ---------------------------------------------------------------------------------------------
// "Sincronizar tudo" em segundo plano

interface RunRecord {
  run: SteamLibrarySyncRun;
  promise: Promise<void>;
}

/**
 * A última rodada completa de cada perfil, em memória (some num restart, e tudo bem: o que foi
 * sincronizado fica no banco). Por banco, para os testes não se misturarem.
 */
const runsByDb = new WeakMap<object, Map<string, RunRecord>>();

function runsOf(ctx: ServiceContext): Map<string, RunRecord> {
  let runs = runsByDb.get(ctx.db);
  if (!runs) {
    runs = new Map();
    runsByDb.set(ctx.db, runs);
  }
  return runs;
}

/** A rodada em andamento ou a última que terminou (null se não houve desde o boot). */
export function getSteamLibrarySyncRun(ctx: ServiceContext): SteamLibrarySyncRun | null {
  const record = runsOf(ctx).get(ctx.userId);
  return record ? { ...record.run } : null;
}

/**
 * Começa o "Sincronizar tudo" em segundo plano e devolve na hora. Se já está rodando para este
 * perfil, devolve a mesma rodada (clicar duas vezes não dobra as chamadas à Steam). Sem perfil
 * ligado ou com a Steam em pausa, falha já aqui.
 */
export function startSteamLibrarySync(
  ctx: ServiceContext,
  deps: SteamSyncDeps,
  /** Só esses jogos (as conquistas dos recém-importados pelo MCP). */
  options: { gameIds?: number[] } = {},
): SteamLibrarySyncRun {
  const runs = runsOf(ctx);
  const current = runs.get(ctx.userId);
  if (current?.run.status === "running") return { ...current.run };
  requireSteamProfile(ctx);
  const until = deps.steamUser.pausedUntil();
  if (until) throw new SourceRateLimitedError("a Steam", until);

  const run: SteamLibrarySyncRun = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    done: 0,
    total: 0,
    result: null,
    error: null,
  };
  const promise = (async () => {
    try {
      run.result = await syncSteamLibrary(ctx, deps, {
        gameIds: options.gameIds,
        onProgress: (done, total) => {
          run.done = done;
          run.total = total;
        },
      });
      run.status = "done";
    } catch (error) {
      run.status = "failed";
      run.error = error instanceof AppError ? error.message : "Não foi possível falar com a Steam";
      if (!(error instanceof AppError)) console.error("Sincronizar tudo (Steam):", error);
      if (error instanceof AppError) {
        // Aparece nos Ajustes como o erro da sincronização (ex.: a pausa pedida pela Steam).
        const state = getAutoSyncState(ctx);
        setAutoSyncState(ctx, {
          lastRunAt: state?.lastRunAt ?? ctx.now.toISOString(),
          lastError: { message: error.message, at: new Date().toISOString() },
        });
      }
    } finally {
      run.finishedAt = new Date().toISOString();
    }
  })();
  runs.set(ctx.userId, { run, promise });
  return { ...run };
}

/** Espera a rodada deste perfil terminar, por até `timeoutMs`, e devolve como ela está. */
export async function waitForSteamLibrarySync(
  ctx: ServiceContext,
  timeoutMs: number,
): Promise<SteamLibrarySyncRun | null> {
  const record = runsOf(ctx).get(ctx.userId);
  if (!record) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    record.promise,
    new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return { ...record.run };
}

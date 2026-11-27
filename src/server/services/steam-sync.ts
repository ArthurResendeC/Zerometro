import { and, eq, inArray } from "drizzle-orm";
import type { LibraryItem } from "../../shared/library";
import {
  STEAM_AUTO_SYNC_INTERVAL_MS,
  type SteamAutoSync,
  type SteamGameSync,
  type SteamLibrarySync,
  type SteamProfile,
} from "../../shared/steam";
import type { AchievementSet } from "../db/schema";
import {
  achievementUnlocks,
  achievements,
  libraryEntries,
  userAchievementSets,
} from "../db/schema";
import { AppError, SteamNotLinkedError, SteamProfilePrivateError } from "../errors";
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
// Manual (botão no jogo ou "Sincronizar tudo"): completa, na hora. Automática (ao abrir o app):
// no máximo a cada STEAM_AUTO_SYNC_INTERVAL_MS e incremental, só nos jogos que mudaram.

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
  options: { gameIds?: number[] } = {},
): Promise<SteamLibrarySync> {
  const profile = requireSteamProfile(ctx);
  const owned = new Map(
    (await deps.steamUser.getOwnedGames(profile.steamId)).map((g) => [g.appId, g]),
  );
  const only = options.gameIds && new Set(options.gameIds);
  const items = listLibrary(ctx).filter((item) => !only || only.has(item.gameId));
  const games: SteamGameSync[] = [];
  for (const item of items) {
    try {
      // Um de cada vez, de propósito: a Steam e o IGDB têm limite de requisições.
      // oxlint-disable-next-line no-await-in-loop
      const result = await syncOne(ctx, deps, profile, item, await locate(ctx, deps, item), owned);
      if (result.appId !== null) games.push(result);
    } catch (error) {
      // Perfil privado vale para todos os jogos: não adianta continuar.
      if (error instanceof SteamProfilePrivateError || !(error instanceof AppError)) throw error;
      games.push({ ...emptyResult(item), error: error.message });
    }
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
  const unlocked = steamSet ? await deps.steamUser.getUnlocked(profile.steamId, appId) : null;
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
        if (error instanceof SteamProfilePrivateError || !(error instanceof AppError)) throw error;
        games.push({ ...emptyResult(item), error: error.message });
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

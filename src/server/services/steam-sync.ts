import { and, eq, inArray } from "drizzle-orm";
import type { SteamGameSync, SteamLibrarySync, SteamProfile } from "../../shared/steam";
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
import { getSteamProfile } from "./steam-account";
import type { SteamOwnedGame, SteamUserApi } from "./steam/user";

// Sincronização manual com a conta Steam: traz as conquistas desbloqueadas (com a data real) e
// o tempo total de cada jogo. Só adiciona desbloqueios, nunca desmarca os manuais. O tempo da
// Steam fica guardado à parte; ele só vale como "tempo jogado" se o jogo usar a Steam como fonte.

export interface SteamSyncDeps {
  catalog: AchievementCatalog;
  igdb: IgdbApi;
  steamUser: SteamUserApi;
}

function requireProfile(ctx: ServiceContext): SteamProfile {
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
  const profile = requireProfile(ctx);
  const item = getLibraryItem(ctx, gameId);
  const result = await syncOne(ctx, deps, profile, item, null);
  logSync(ctx, [result]);
  return result;
}

/** Sincroniza todos os jogos da biblioteca que estão na Steam, um de cada vez. */
export async function syncSteamLibrary(
  ctx: ServiceContext,
  deps: SteamSyncDeps,
): Promise<SteamLibrarySync> {
  const profile = requireProfile(ctx);
  const owned = new Map(
    (await deps.steamUser.getOwnedGames(profile.steamId)).map((g) => [g.appId, g]),
  );
  const games: SteamGameSync[] = [];
  for (const item of listLibrary(ctx)) {
    try {
      // Um de cada vez, de propósito: a Steam e o IGDB têm limite de requisições.
      // oxlint-disable-next-line no-await-in-loop
      const result = await syncOne(ctx, deps, profile, item, owned);
      if (result.appId !== null) games.push(result);
    } catch (error) {
      // Perfil privado vale para todos os jogos: não adianta continuar.
      if (error instanceof SteamProfilePrivateError || !(error instanceof AppError)) throw error;
      games.push({ ...emptyResult(item), error: error.message });
    }
  }
  logSync(ctx, games);
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
  linkedSet: false,
  error: null,
});

/**
 * Um jogo: acha o app (lista da Steam ligada ou o do IGDB), as horas (se está na conta) e os
 * desbloqueios. `owned` é a conta inteira (sincronizar tudo) ou null (busca só este app).
 */
async function syncOne(
  ctx: ServiceContext,
  deps: SteamSyncDeps,
  profile: SteamProfile,
  item: { gameId: number; name: string },
  owned: Map<number, SteamOwnedGame> | null,
): Promise<SteamGameSync> {
  const result = emptyResult(item);
  const sets = linkedSets(ctx, item.gameId);
  let steamSet: AchievementSet | null = sets.find((s) => s.source === "steam") ?? null;
  const appId = steamSet
    ? Number(steamSet.externalId)
    : await steamAppIdOf(ctx, deps.igdb, item.gameId);
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
  });
  return result;
}

function logSync(ctx: ServiceContext, games: SteamGameSync[]) {
  logActivity(ctx.db, ctx, "steam.sync", {
    games: games.map((g) => ({
      gameId: g.gameId,
      appId: g.appId,
      minutes: g.steamMinutes,
      newUnlocks: g.newUnlocks,
      ...(g.linkedSet && { linkedSet: true }),
      ...(g.error && { error: g.error }),
    })),
  });
}

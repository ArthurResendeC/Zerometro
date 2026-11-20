import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  type AchievementCandidates,
  type AchievementCandidatesQuery,
  type AchievementItem,
  type AchievementSetCandidate,
  type AchievementSetItem,
  type AchievementsSummary,
  type AchievementSource,
  achievementSourceLabels,
  achievementSourceUrl,
  achievementsDone,
  type AchievementWriteResult,
  type GameAchievements,
  type LinkAchievementSetInput,
  parseSourceGameId,
  type SetAchievementInput,
} from "../../shared/achievements";
import { zonedToInstant } from "../../shared/dates";
import {
  type AchievementSet,
  achievementSets,
  achievementUnlocks,
  achievements,
  games,
  userAchievementSets,
} from "../db/schema";
import { AppError, NotFoundError, ValidationError } from "../errors";
import type { AchievementCatalog } from "./achievement-catalog";
import { logActivity } from "./activity";
import type { ServiceContext, UserScope } from "./context";
import { syncGameFromIgdb } from "./games";
import type { IgdbApi } from "./igdb";
import { getLibraryItem } from "./library";
import { findRaConsole, raConsolesFor } from "../../shared/ra-consoles";
import { matchRaGames } from "./retroachievements/match";

// Conquistas de um jogo na biblioteca: quais listas (Steam, RA) ele segue e o que o usuário já
// desbloqueou. As listas são da fonte e só leitura; o usuário só liga, desliga e marca.

const MAX_CANDIDATES = 8;

// ---------------------------------------------------------------------------
// Leitura

/** As listas que o jogo segue, com o progresso. Lista vencida é atualizada em segundo plano. */
export function listGameAchievements(
  scope: UserScope,
  catalog: AchievementCatalog,
  gameId: number,
): GameAchievements {
  getLibraryItem(scope, gameId); // 404 se o jogo não estiver na biblioteca
  const linked = linkedSets(scope, gameId);
  for (const set of linked) catalog.refreshIfStale(set);
  const sets = withProgress(scope, linked);
  return { gameId, sources: catalog.enabled, sets, summary: sumUp(sets) };
}

function linkedSets({ db, userId }: UserScope, gameId: number): AchievementSet[] {
  return db
    .select({ set: achievementSets })
    .from(userAchievementSets)
    .innerJoin(achievementSets, eq(achievementSets.id, userAchievementSets.setId))
    .where(and(eq(userAchievementSets.userId, userId), eq(userAchievementSets.gameId, gameId)))
    .orderBy(asc(userAchievementSets.id))
    .all()
    .map((row) => row.set);
}

function withProgress({ db, userId }: UserScope, sets: AchievementSet[]): AchievementSetItem[] {
  if (sets.length === 0) return [];
  const rows = db
    .select({
      a: achievements,
      unlockedAt: achievementUnlocks.unlockedAt,
      origin: achievementUnlocks.origin,
    })
    .from(achievements)
    .leftJoin(
      achievementUnlocks,
      and(
        eq(achievementUnlocks.achievementId, achievements.id),
        eq(achievementUnlocks.userId, userId),
      ),
    )
    .where(
      inArray(
        achievements.setId,
        sets.map((s) => s.id),
      ),
    )
    .orderBy(asc(achievements.sortOrder), asc(achievements.id))
    .all();

  return sets.map((set) => {
    const items: AchievementItem[] = rows
      .filter(({ a, unlockedAt }) => a.setId === set.id && (!a.removedAt || unlockedAt))
      .map(({ a, unlockedAt, origin }) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        iconUrl: a.iconUrl,
        iconLockedUrl: a.iconLockedUrl,
        rarity: a.rarity,
        points: a.points,
        hidden: a.hidden,
        removed: a.removedAt !== null,
        unlockedAt,
        origin,
      }));
    return {
      id: set.id,
      source: set.source,
      externalId: set.externalId,
      title: set.title,
      platform: set.platform,
      url: achievementSourceUrl(set.source, set.externalId),
      fetchedAt: set.fetchedAt,
      ...summarize(items),
      achievements: items,
    };
  });
}

/** Conquistas removidas da fonte ficam fora das contas. */
function summarize(items: AchievementItem[]): AchievementsSummary {
  const summary = { total: 0, unlocked: 0, points: 0, pointsUnlocked: 0 };
  for (const item of items) {
    if (item.removed) continue;
    summary.total += 1;
    summary.points += item.points ?? 0;
    if (item.unlockedAt) {
      summary.unlocked += 1;
      summary.pointsUnlocked += item.points ?? 0;
    }
  }
  return summary;
}

function sumUp(sets: AchievementsSummary[]): AchievementsSummary | null {
  if (sets.length === 0) return null;
  return sets.reduce(
    (acc, s) => ({
      total: acc.total + s.total,
      unlocked: acc.unlocked + s.unlocked,
      points: acc.points + s.points,
      pointsUnlocked: acc.pointsUnlocked + s.pointsUnlocked,
    }),
    { total: 0, unlocked: 0, points: 0, pointsUnlocked: 0 },
  );
}

// ---------------------------------------------------------------------------
// Achar e ligar listas

/**
 * Listas que dá para ligar ao jogo: a da Steam pelo appid do IGDB e as do RA pelo nome, nos
 * consoles das plataformas do jogo (ou no console e nome escolhidos). Uma fonte que falha vai
 * para `errors` sem derrubar as outras.
 */
export async function findSetCandidates(
  ctx: ServiceContext,
  catalog: AchievementCatalog,
  igdb: IgdbApi,
  gameId: number,
  query: AchievementCandidatesQuery = {},
): Promise<AchievementCandidates> {
  const item = getLibraryItem(ctx, gameId);
  const linked = new Set(linkedSets(ctx, gameId).map((s) => `${s.source}:${s.externalId}`));
  const candidates: AchievementSetCandidate[] = [];
  const errors: AchievementCandidates["errors"] = [];
  const fail = (source: AchievementSource, error: unknown) => {
    if (!(error instanceof AppError)) throw error;
    errors.push({ source, message: error.message });
  };

  if (catalog.enabled.steam) {
    try {
      const appId = await steamAppIdOf(ctx, igdb, gameId);
      const set = appId === null ? null : await ensureSetOrNull(catalog, "steam", String(appId));
      if (set) {
        candidates.push({
          source: "steam",
          externalId: set.externalId,
          title: set.title ?? item.name,
          platform: null,
          iconUrl: null,
          achievementsCount: countActive(ctx, set.id),
          points: null,
          via: "igdb",
          subset: false,
          linked: linked.has(`steam:${set.externalId}`),
        });
      }
    } catch (error) {
      fail("steam", error);
    }
  }

  const consoles = query.consoleId
    ? [
        findRaConsole(query.consoleId) ?? {
          id: query.consoleId,
          name: `Console ${query.consoleId}`,
        },
      ]
    : raConsolesFor(item.platforms);
  if (catalog.enabled.retroachievements && consoles.length > 0) {
    try {
      const lists = await Promise.all(consoles.map((c) => catalog.raGames(c.id)));
      const matches = matchRaGames(query.q ?? item.name, lists.flat(), MAX_CANDIDATES);
      for (const game of matches) {
        candidates.push({
          source: "retroachievements",
          externalId: String(game.id),
          title: game.title,
          platform: game.consoleName,
          iconUrl: game.iconUrl,
          achievementsCount: game.achievements,
          points: game.points,
          via: "name",
          subset: game.subset,
          linked: linked.has(`retroachievements:${game.id}`),
        });
      }
    } catch (error) {
      fail("retroachievements", error);
    }
  }

  return {
    sources: catalog.enabled,
    candidates,
    consoles: consoles.map(({ id, name }) => ({ id, name })),
    errors,
  };
}

/** O appid do cache; jogos gravados antes das conquistas são buscados de novo no IGDB. */
async function steamAppIdOf(
  ctx: ServiceContext,
  igdb: IgdbApi,
  gameId: number,
): Promise<number | null> {
  const game = ctx.db.select().from(games).where(eq(games.id, gameId)).get();
  if (!game) throw new NotFoundError(`Jogo ${gameId} não encontrado`);
  if (game.steamAppId !== null) return game.steamAppId;
  return (await syncGameFromIgdb(ctx.db, igdb, game.igdbId)).steamAppId;
}

async function ensureSetOrNull(
  catalog: AchievementCatalog,
  source: AchievementSource,
  externalId: string,
): Promise<AchievementSet | null> {
  try {
    return await catalog.ensureSet(source, externalId);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

function countActive({ db }: UserScope, setId: number): number {
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(achievements)
      .where(and(eq(achievements.setId, setId), isNull(achievements.removedAt)))
      .get()?.count ?? 0
  );
}

/** O jogo passa a seguir a lista (busca na fonte se ainda não estiver guardada). */
export async function linkSet(
  ctx: ServiceContext,
  catalog: AchievementCatalog,
  gameId: number,
  input: LinkAchievementSetInput,
): Promise<GameAchievements> {
  const item = getLibraryItem(ctx, gameId);
  const label = achievementSourceLabels[input.source];
  const id = parseSourceGameId(input.source, input.id);
  if (id === null) throw new ValidationError(`Não reconheci um jogo da ${label} em "${input.id}"`);

  const set = await catalog.ensureSet(input.source, String(id));
  ctx.db.transaction((tx) => {
    tx.insert(userAchievementSets)
      .values({ userId: ctx.userId, gameId, setId: set.id })
      .onConflictDoNothing()
      .run();
    logActivity(tx, ctx, "achievements.link", {
      gameId,
      name: item.name,
      setId: set.id,
      source: set.source,
      externalId: set.externalId,
    });
  });
  return listGameAchievements(ctx, catalog, gameId);
}

/** O jogo deixa de seguir a lista. Os desbloqueios ficam guardados (voltam se ligar de novo). */
export function unlinkSet(
  ctx: ServiceContext,
  catalog: AchievementCatalog,
  gameId: number,
  setId: number,
): GameAchievements {
  const item = getLibraryItem(ctx, gameId);
  const set = linkedSets(ctx, gameId).find((s) => s.id === setId);
  if (!set) throw new NotFoundError(`O jogo ${gameId} não segue a lista ${setId}`);
  ctx.db.transaction((tx) => {
    tx.delete(userAchievementSets)
      .where(
        and(
          eq(userAchievementSets.userId, ctx.userId),
          eq(userAchievementSets.gameId, gameId),
          eq(userAchievementSets.setId, setId),
        ),
      )
      .run();
    logActivity(tx, ctx, "achievements.unlink", {
      gameId,
      name: item.name,
      setId,
      source: set.source,
      externalId: set.externalId,
    });
  });
  return listGameAchievements(ctx, catalog, gameId);
}

/** Botão "Atualizar": busca de novo na fonte as listas que o jogo segue. */
export async function refreshGameSets(
  ctx: ServiceContext,
  catalog: AchievementCatalog,
  gameId: number,
): Promise<GameAchievements> {
  getLibraryItem(ctx, gameId);
  await Promise.all(
    linkedSets(ctx, gameId).map((set) =>
      catalog.ensureSet(set.source, set.externalId, { force: true }),
    ),
  );
  return listGameAchievements(ctx, catalog, gameId);
}

// ---------------------------------------------------------------------------
// Desbloquear

/** Marca ou desmarca uma conquista de uma lista que o jogo segue. */
export function setAchievementUnlocked(
  ctx: ServiceContext,
  catalog: AchievementCatalog,
  gameId: number,
  achievementId: number,
  input: SetAchievementInput,
): AchievementWriteResult {
  return setManyUnlocked(ctx, catalog, gameId, [achievementId], input);
}

/**
 * Marca ou desmarca várias de uma vez ("marcar todas"). Desbloquear de novo só troca a data se
 * ela for informada. Completar a lista sugere marcar o 100%, sem criar a conclusão sozinho.
 */
export function setManyUnlocked(
  ctx: ServiceContext,
  catalog: AchievementCatalog,
  gameId: number,
  ids: number[],
  input: SetAchievementInput,
): AchievementWriteResult {
  const item = getLibraryItem(ctx, gameId);
  const before = listGameAchievements(ctx, catalog, gameId);
  const byId = new Map(before.sets.flatMap((s) => s.achievements).map((a) => [a.id, a]));
  const unique = [...new Set(ids)];
  const missing = unique.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new NotFoundError(`Conquista ${missing.join(", ")} não está nas listas deste jogo`);
  }
  const unlockedAt = unlockInstant(ctx, input.unlockedOn);

  ctx.db.transaction((tx) => {
    if (input.unlocked) {
      for (const id of unique) {
        const current = byId.get(id)!;
        if (current.unlockedAt && !input.unlockedOn) continue;
        tx.insert(achievementUnlocks)
          .values({ userId: ctx.userId, achievementId: id, unlockedAt, origin: "manual" })
          .onConflictDoUpdate({
            target: [achievementUnlocks.userId, achievementUnlocks.achievementId],
            set: { unlockedAt, origin: "manual" },
          })
          .run();
      }
    } else {
      tx.delete(achievementUnlocks)
        .where(
          and(
            eq(achievementUnlocks.userId, ctx.userId),
            inArray(achievementUnlocks.achievementId, unique),
          ),
        )
        .run();
    }
    logActivity(tx, ctx, input.unlocked ? "achievement.unlock" : "achievement.lock", {
      gameId,
      name: item.name,
      achievementIds: unique,
      titles: unique.slice(0, 20).map((id) => byId.get(id)!.title),
      ...(input.unlockedOn && { unlockedOn: input.unlockedOn }),
    });
  });

  const after = listGameAchievements(ctx, catalog, gameId);
  const changed = new Set(unique);
  const allDoneNow = achievementsDone(after.summary) && !achievementsDone(before.summary);
  const best = allDoneNow ? getLibraryItem(ctx, gameId).completion?.best : undefined;
  return {
    achievements: after.sets.flatMap((s) => s.achievements).filter((a) => changed.has(a.id)),
    summary: after.summary!,
    allDoneNow,
    suggestFullCompletion: allDoneNow && best !== "full",
  };
}

/** Agora, ou meio-dia (no fuso do usuário) do dia informado. Dia no futuro não vale. */
function unlockInstant(ctx: ServiceContext, unlockedOn: string | undefined): string {
  if (!unlockedOn || unlockedOn === ctx.today) return ctx.now.toISOString();
  if (unlockedOn > ctx.today) {
    throw new ValidationError("A data do desbloqueio não pode ser no futuro");
  }
  return zonedToInstant(unlockedOn, "12:00", ctx.timeZone).toISOString();
}

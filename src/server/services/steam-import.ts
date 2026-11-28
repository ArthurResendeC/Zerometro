import { and, eq } from "drizzle-orm";
import {
  type SteamImportCandidate,
  type SteamImportInput,
  type SteamImportPreview,
  type SteamImportResult,
  steamImportSchema,
  suggestedImportStatus,
} from "../../shared/steam";
import { achievementSets, games, libraryEntries, userAchievementSets } from "../db/schema";
import { SourceRateLimitedError } from "../errors";
import { ensureSetOrNull } from "./achievements";
import type { ServiceContext } from "./context";
import { saveGame } from "./games";
import { insertLibraryEntry } from "./library";
import { getIgnoredSteamApps, setIgnoredSteamApps } from "./steam-account";
import { requireSteamProfile, type SteamSyncDeps } from "./steam-sync";
import type { SteamOwnedGame } from "./steam/user";

// Importar a biblioteca da Steam: os jogos da conta que ainda não estão no Zerômetro entram com o
// tempo da Steam como tempo jogado. Separado do "Sincronizar tudo" de propósito: quem tem centenas
// de jogos escolhe o que entra, e o que fica de fora vai para os ignorados (não vem marcado de
// novo). As conquistas vêm depois, em lotes (`syncSteamLibrary` com `gameIds`), para a resposta
// não demorar com a biblioteca inteira.

/** O que já está na biblioteca, pelos dois lados: o app da Steam e o jogo do IGDB. */
function libraryKeys(ctx: ServiceContext) {
  const rows = ctx.db
    .select({ igdbId: games.igdbId, steamAppId: games.steamAppId })
    .from(libraryEntries)
    .innerJoin(games, eq(games.id, libraryEntries.gameId))
    .where(eq(libraryEntries.userId, ctx.userId))
    .all();
  // Jogo que segue a lista da Steam de outro app (colou a URL da loja): esse app também conta.
  const linked = ctx.db
    .select({ externalId: achievementSets.externalId })
    .from(userAchievementSets)
    .innerJoin(achievementSets, eq(achievementSets.id, userAchievementSets.setId))
    .where(and(eq(userAchievementSets.userId, ctx.userId), eq(achievementSets.source, "steam")))
    .all();
  return {
    igdbIds: new Set(rows.map((r) => r.igdbId)),
    appIds: new Set([
      ...rows.flatMap((r) => (r.steamAppId === null ? [] : [r.steamAppId])),
      ...linked.map((l) => Number(l.externalId)),
    ]),
  };
}

const byMinutesThenName = (
  a: { minutes: number; name: string | null },
  b: { minutes: number; name: string | null },
) => b.minutes - a.minutes || (a.name ?? "").localeCompare(b.name ?? "", "pt-BR");

/** Os jogos da conta que ainda não estão na biblioteca, com o jogo do IGDB de cada um. */
export async function previewSteamImport(
  ctx: ServiceContext,
  deps: SteamSyncDeps,
): Promise<SteamImportPreview> {
  const profile = requireSteamProfile(ctx);
  const owned = await deps.steamUser.getOwnedGames(profile.steamId);
  const library = libraryKeys(ctx);
  const ignored = getIgnoredSteamApps(ctx);
  const outside = owned.filter((g) => !library.appIds.has(g.appId));
  const matches = await deps.igdb.findBySteamAppIds(outside.map((g) => g.appId));

  let inLibrary = owned.length - outside.length;
  const unmatched: SteamImportPreview["unmatched"] = [];
  const byIgdb = new Map<number, SteamImportCandidate>();
  for (const game of outside) {
    const match = matches.get(game.appId);
    if (!match) {
      unmatched.push({ appId: game.appId, name: game.name, minutes: game.minutes });
      continue;
    }
    if (library.igdbIds.has(match.igdbId)) {
      inLibrary++;
      continue;
    }
    // Dois apps do mesmo jogo (ex.: a versão antiga e a nova): fica o mais jogado.
    const current = byIgdb.get(match.igdbId);
    if (current && current.minutes >= game.minutes) continue;
    const lastPlayedAt = game.lastPlayedAt?.toISOString() ?? null;
    const { recentMinutes } = game;
    byIgdb.set(match.igdbId, {
      appId: game.appId,
      igdbId: match.igdbId,
      name: match.name,
      steamName: game.name && game.name !== match.name ? game.name : null,
      coverImageId: match.coverImageId,
      releaseYear: match.releaseYear,
      minutes: game.minutes,
      recentMinutes,
      lastPlayedAt,
      suggestedStatus: suggestedImportStatus({ lastPlayedAt, recentMinutes }, ctx.now),
      ignored: ignored.has(game.appId),
    });
  }

  return {
    candidates: [...byIgdb.values()].toSorted(byMinutesThenName),
    unmatched: unmatched.toSorted(byMinutesThenName),
    inLibrary,
    hidesPlaytime: owned.length > 0 && owned.every((g) => g.minutes === 0 && !g.lastPlayedAt),
  };
}

/**
 * Põe na biblioteca os jogos escolhidos, com o tempo da Steam como tempo jogado, e guarda os
 * desmarcados como ignorados. Confere de novo a conta e a biblioteca (a prévia pode ser antiga).
 */
export async function importSteamGames(
  ctx: ServiceContext,
  deps: SteamSyncDeps,
  rawInput: SteamImportInput,
): Promise<SteamImportResult> {
  const input = steamImportSchema.parse(rawInput);
  const profile = requireSteamProfile(ctx);
  const owned = new Map<number, SteamOwnedGame>(
    (await deps.steamUser.getOwnedGames(profile.steamId)).map((g) => [g.appId, g]),
  );
  const library = libraryKeys(ctx);
  const skipped: SteamImportResult["skipped"] = [];

  const wanted = new Map<number, (typeof input.games)[number]>();
  for (const choice of input.games) {
    if (!owned.has(choice.appId)) {
      skipped.push({ appId: choice.appId, reason: "Não está na sua conta Steam" });
    } else if (library.appIds.has(choice.appId)) {
      skipped.push({ appId: choice.appId, reason: "Já está na biblioteca" });
    } else {
      wanted.set(choice.appId, choice);
    }
  }

  const matches = await deps.igdb.findBySteamAppIds([...wanted.keys()]);
  const igdbIds = new Set<number>();
  for (const appId of wanted.keys()) {
    const igdbId = matches.get(appId)?.igdbId;
    const reason =
      igdbId === undefined
        ? "O IGDB não conhece esse jogo"
        : library.igdbIds.has(igdbId)
          ? "Já está na biblioteca"
          : igdbIds.has(igdbId)
            ? "Outro app do mesmo jogo já foi escolhido"
            : null;
    if (reason === null && igdbId !== undefined) {
      igdbIds.add(igdbId);
    } else {
      skipped.push({ appId, reason: reason ?? "O IGDB não conhece esse jogo" });
      wanted.delete(appId);
    }
  }

  const details = new Map(
    (await deps.igdb.getGames([...igdbIds])).map((d) => [d.igdbId, d] as const),
  );
  const added: SteamImportResult["added"] = [];
  /** Jogos em que o IGDB conhece outro app da Steam: a lista certa é a do app da conta. */
  const otherApp: { gameId: number; appId: number }[] = [];
  ctx.db.transaction((tx) => {
    for (const [appId, choice] of wanted) {
      const igdbId = matches.get(appId)?.igdbId;
      const detail = igdbId === undefined ? undefined : details.get(igdbId);
      if (!detail) {
        skipped.push({ appId, reason: "O IGDB não conhece esse jogo" });
        continue;
      }
      const game = saveGame(tx, detail);
      const account = owned.get(appId);
      const status =
        choice.status ??
        suggestedImportStatus(
          {
            lastPlayedAt: account?.lastPlayedAt?.toISOString() ?? null,
            recentMinutes: account?.recentMinutes ?? 0,
          },
          ctx.now,
        );
      insertLibraryEntry(
        tx,
        ctx,
        game,
        {
          status,
          platformPlayed: detail.platforms.includes("PC") ? "PC" : null,
          playtimeSource: "steam",
          // Sem `steamSyncedAt` de propósito: o jogo conta como "nunca sincronizado", então se
          // a busca das conquistas parar no meio, a sincronização automática termina.
          steamMinutes: account?.minutes ?? null,
        },
        { source: "steam", appId },
      );
      added.push({ gameId: game.id, appId, name: game.name, status });
      if (game.steamAppId !== appId) otherApp.push({ gameId: game.id, appId });
    }
    const ignored = getIgnoredSteamApps({ db: tx, userId: ctx.userId });
    for (const appId of input.ignore) ignored.add(appId);
    for (const { appId } of added) ignored.delete(appId);
    setIgnoredSteamApps({ db: tx, userId: ctx.userId }, ignored);
  });

  if (deps.catalog.enabled.steam) {
    for (const { gameId, appId } of otherApp) {
      let set;
      try {
        // Raro (o IGDB costuma ter o mesmo app); um de cada vez por causa do limite da Steam.
        // oxlint-disable-next-line no-await-in-loop
        set = await ensureSetOrNull(deps.catalog, "steam", String(appId));
      } catch (error) {
        // Os jogos já entraram: com a Steam em pausa, as listas ficam para depois.
        if (error instanceof SourceRateLimitedError) break;
        throw error;
      }
      if (!set) continue;
      ctx.db
        .insert(userAchievementSets)
        .values({ userId: ctx.userId, gameId, setId: set.id })
        .onConflictDoNothing()
        .run();
    }
  }

  return { added, skipped, ignored: getIgnoredSteamApps(ctx).size };
}

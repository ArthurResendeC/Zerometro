import { eq } from "drizzle-orm";
import type { IgdbGameDetails } from "../../shared/igdb";
import type { Db } from "../db/client";
import { type Game, games, type NewGame } from "../db/schema";
import { NotFoundError } from "../errors";
import type { IgdbApi } from "./igdb";

// Cache local dos metadados do IGDB (tabela `games`).

export function findGameByIgdbId(db: Db, igdbId: number): Game | null {
  return db.select().from(games).where(eq(games.igdbId, igdbId)).get() ?? null;
}

/** Busca no IGDB e grava/atualiza o jogo no cache. */
export async function syncGameFromIgdb(db: Db, igdb: IgdbApi, igdbId: number): Promise<Game> {
  const details = await igdb.getGame(igdbId);
  if (!details) throw new NotFoundError(`Jogo ${igdbId} não encontrado no IGDB`);

  const { igdbId: _, ...values } = toGameRow(details);
  return db
    .insert(games)
    .values({ igdbId, ...values })
    .onConflictDoUpdate({
      target: games.igdbId,
      set: { ...values, updatedAt: new Date().toISOString() },
    })
    .returning()
    .get();
}

/** Usa o cache se o jogo já existir; senão busca no IGDB. */
export async function ensureGame(db: Db, igdb: IgdbApi, igdbId: number): Promise<Game> {
  return findGameByIgdbId(db, igdbId) ?? syncGameFromIgdb(db, igdb, igdbId);
}

function toGameRow(details: IgdbGameDetails): NewGame {
  const ttb = details.timeToBeat;
  return {
    igdbId: details.igdbId,
    name: details.name,
    slug: details.slug,
    coverImageId: details.coverImageId,
    platforms: details.platforms,
    genres: details.genres,
    releaseYear: details.releaseYear,
    ttbMainSec: ttb?.mainSec ?? null,
    ttbExtraSec: ttb?.extraSec ?? null,
    ttbCompleteSec: ttb?.completeSec ?? null,
    ttbSource: ttb ? "igdb" : null,
    steamAppId: details.steamAppId,
    syncedAt: new Date().toISOString(),
  };
}

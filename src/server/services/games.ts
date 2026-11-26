import { eq, sql } from "drizzle-orm";
import type { SeriesKind } from "../../shared/domain";
import type { IgdbGameDetails, IgdbNamedRef } from "../../shared/igdb";
import type { Db, DbOrTx } from "../db/client";
import {
  companies,
  type Game,
  gameCompanies,
  games,
  gameSeries,
  type NewGame,
  series,
} from "../db/schema";
import { NotFoundError } from "../errors";
import type { IgdbApi } from "./igdb";

// Cache local dos metadados do IGDB (tabela `games`, mais empresas e séries).

/**
 * Sobe quando `saveGame` passar a gravar algo novo do IGDB: o backfill busca de novo os jogos
 * gravados com uma versão menor (ver igdb-backfill-job.ts).
 */
export const IGDB_META_VERSION = 1;

export function findGameByIgdbId(db: Db, igdbId: number): Game | null {
  return db.select().from(games).where(eq(games.igdbId, igdbId)).get() ?? null;
}

/** Busca no IGDB e grava/atualiza o jogo no cache. */
export async function syncGameFromIgdb(db: Db, igdb: IgdbApi, igdbId: number): Promise<Game> {
  const details = await igdb.getGame(igdbId);
  if (!details) throw new NotFoundError(`Jogo ${igdbId} não encontrado no IGDB`);
  return saveGame(db, details);
}

/** Grava/atualiza no cache um jogo que acabou de vir do IGDB, com as empresas e as séries. */
export function saveGame(db: DbOrTx, details: IgdbGameDetails): Game {
  const { igdbId, ...values } = toGameRow(details);
  return db.transaction((tx) => {
    const game = tx
      .insert(games)
      .values({ igdbId, ...values })
      .onConflictDoUpdate({
        target: games.igdbId,
        set: { ...values, updatedAt: new Date().toISOString() },
      })
      .returning()
      .get();

    saveGameLinks(tx, game.id, details);
    return game;
  });
}

/** Metadados do IGDB que viram links (empresas e séries). */
export type GameLinks = Pick<IgdbGameDetails, "companies" | "collections" | "franchises">;

/** Troca as empresas e as séries ligadas a um jogo do cache (as próprias linhas são compartilhadas). */
export function saveGameLinks(db: DbOrTx, gameId: number, details: GameLinks): void {
  db.transaction((tx) => {
    tx.delete(gameCompanies).where(eq(gameCompanies.gameId, gameId)).run();
    for (const credit of details.companies) {
      const company = tx
        .insert(companies)
        .values({ igdbId: credit.igdbId, name: credit.name })
        .onConflictDoUpdate({ target: companies.igdbId, set: { name: credit.name } })
        .returning({ id: companies.id })
        .get();
      tx.insert(gameCompanies)
        .values({
          gameId,
          companyId: company.id,
          developer: credit.developer,
          publisher: credit.publisher,
        })
        .run();
    }

    tx.delete(gameSeries).where(eq(gameSeries.gameId, gameId)).run();
    const refs: [SeriesKind, IgdbNamedRef][] = [
      ...details.collections.map((ref) => ["collection", ref] as [SeriesKind, IgdbNamedRef]),
      ...details.franchises.map((ref) => ["franchise", ref] as [SeriesKind, IgdbNamedRef]),
    ];
    for (const [kind, ref] of refs) {
      const row = tx
        .insert(series)
        .values({ igdbId: ref.igdbId, kind, name: ref.name })
        .onConflictDoUpdate({ target: [series.kind, series.igdbId], set: { name: ref.name } })
        .returning({ id: series.id })
        .get();
      tx.insert(gameSeries).values({ gameId, seriesId: row.id }).run();
    }
  });
}

/** Ids do IGDB dos jogos gravados com metadados de uma versão antiga (alvo do backfill). */
export function staleMetaIgdbIds(db: Db, limit: number): number[] {
  return db
    .select({ igdbId: games.igdbId })
    .from(games)
    .where(sql`${games.metaVersion} < ${IGDB_META_VERSION}`)
    .orderBy(games.id)
    .limit(limit)
    .all()
    .map((row) => row.igdbId);
}

/** Marca como atualizados jogos que o IGDB não devolveu mais (sumiram de lá): o backfill não insiste. */
export function markMetaChecked(db: Db, igdbIds: number[]): void {
  if (igdbIds.length === 0) return;
  db.update(games)
    .set({ metaVersion: IGDB_META_VERSION })
    .where(sql`${games.igdbId} in ${igdbIds}`)
    .run();
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
    themes: details.themes,
    gameModes: details.gameModes,
    perspectives: details.perspectives,
    releaseYear: details.releaseYear,
    ttbMainSec: ttb?.mainSec ?? null,
    ttbExtraSec: ttb?.extraSec ?? null,
    ttbCompleteSec: ttb?.completeSec ?? null,
    ttbSource: ttb ? "igdb" : null,
    steamAppId: details.steamAppId,
    steamCheckedAt: new Date().toISOString(),
    syncedAt: new Date().toISOString(),
    metaVersion: IGDB_META_VERSION,
  };
}

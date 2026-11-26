import type { Db } from "../db/client";
import { IgdbNotConfiguredError } from "../errors";
import { markMetaChecked, saveGame, staleMetaIgdbIds } from "./games";
import type { IgdbApi } from "./igdb";

// Backfill dos metadados do IGDB: quando `saveGame` passa a gravar algo novo (temas, empresas,
// séries…), os jogos já no cache são buscados de novo, em lotes, uma vez depois do boot.
// Os jogos novos já entram completos; isto só alcança os antigos.

/** Jogos por lote (o `getGames` faz 2 queries por lote no IGDB). */
const BATCH = 250;
const FIRST_RUN_DELAY_MS = 30_000;

/** Busca de novo os jogos desatualizados. Devolve quantos foram atualizados. */
export async function runIgdbBackfill(db: Db, igdb: IgdbApi): Promise<number> {
  let updated = 0;
  for (;;) {
    const ids = staleMetaIgdbIds(db, BATCH);
    if (ids.length === 0) return updated;
    // Um lote de cada vez: o cliente já segura o limite de requisições do IGDB.
    // oxlint-disable-next-line no-await-in-loop
    const details = await igdb.getGames(ids);
    db.transaction((tx) => {
      for (const game of details) saveGame(tx, game);
    });
    // O que o IGDB não devolveu (jogo removido de lá) fica marcado, para não repetir para sempre.
    const found = new Set(details.map((d) => d.igdbId));
    markMetaChecked(
      db,
      ids.filter((id) => !found.has(id)),
    );
    updated += details.length;
  }
}

/** Agenda o backfill para logo depois do boot. Devolve a função que cancela. */
export function startIgdbBackfill(db: Db, igdb: IgdbApi): () => void {
  const timer = setTimeout(async () => {
    try {
      const updated = await runIgdbBackfill(db, igdb);
      if (updated > 0) console.log(`Metadados do IGDB atualizados em ${updated} jogos.`);
    } catch (error) {
      // Sem credenciais não há o que fazer; qualquer outra falha tenta de novo no próximo boot.
      if (error instanceof IgdbNotConfiguredError) return;
      console.error("Backfill dos metadados do IGDB:", error);
    }
  }, FIRST_RUN_DELAY_MS);
  return () => clearTimeout(timer);
}

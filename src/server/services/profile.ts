import { eq, inArray } from "drizzle-orm";
import { type LibraryItem, platformLabel } from "../../shared/library";
import {
  type GamerProfile,
  PROFILE_ROW_GAMES,
  type ProfileRow,
  sortProfileRows,
} from "../../shared/profile";
import { companies, gameCompanies, gameSeries, series } from "../db/schema";
import type { UserScope } from "./context";
import { listLibrary } from "./library";

// Perfil de gamer: rankings de devs, publishers, séries, gêneros… a partir da biblioteca. Usa o
// total de cada jogo da biblioteca (sessões + tempo de antes, ou a Steam), sem recorte de período.
// As publishers são as que o IGDB credita (inclusive as regionais).

interface Tag {
  key: string;
  name: string;
}

/** O perfil completo, cada ranking já ordenado por horas. */
export function getProfile(scope: UserScope): GamerProfile {
  const items = listLibrary(scope).filter(counts);
  const gameIds = items.map((i) => i.gameId);
  const credits = companyCredits(scope, gameIds);
  const memberships = seriesMemberships(scope, gameIds);

  return {
    gamesCounted: items.length,
    totalMinutes: items.reduce((sum, i) => sum + i.minutesPlayed, 0),
    developers: rank(items, (i) => credits.get(i.gameId)?.developers ?? []),
    publishers: rank(items, (i) => credits.get(i.gameId)?.publishers ?? []),
    series: rank(items, (i) => memberships.get(i.gameId)?.collection ?? [], {
      mergeSameGames: "shortest",
    }),
    franchises: rank(items, (i) => memberships.get(i.gameId)?.franchise ?? [], {
      mergeSameGames: "join",
    }),
    genres: rank(items, (i) => tags(i.genres)),
    themes: rank(items, (i) => tags(i.themes)),
    perspectives: rank(items, (i) => tags(i.perspectives)),
    gameModes: rank(items, (i) => tags(i.gameModes)),
    // "Switch (emulado no PC)" fica separado do Switch de verdade.
    platforms: rank(items, (i) => {
      const label = platformLabel(i);
      return tags(label ? [label] : []);
    }),
  };
}

/** Tags que já são nomes (gêneros, temas…): a chave é o próprio nome. */
function tags(values: string[]): Tag[] {
  return values.map((v) => ({ key: v, name: v }));
}

/** Entra no perfil quem já foi jogado ou zerado (desejos e próximos intocados ficam de fora). */
function counts(item: LibraryItem): boolean {
  return item.minutesPlayed > 0 || isFinished(item);
}

function isFinished(item: LibraryItem): boolean {
  return item.completion !== null || item.status === "finished";
}

/**
 * Uma linha por tag. Com `mergeSameGames`, linhas com exatamente os mesmos jogos viram uma só
 * (o IGDB põe o jogo na série e numa sub-série, ou em franquias aninhadas):
 * - `shortest` fica com o nome mais curto, que nas séries costuma ser o da mais ampla ("The Legend
 *   of Zelda" e não "…: Breath of the Wild"; "Persona" e não "Persona 5");
 * - `join` junta os nomes, do mais curto ao mais longo: nas franquias o nome não diz qual é a mais
 *   ampla ("Persona · Megami Tensei · Shin Megami Tensei").
 */
function rank(
  items: LibraryItem[],
  tagsOf: (item: LibraryItem) => Tag[],
  { mergeSameGames }: { mergeSameGames?: "shortest" | "join" } = {},
): ProfileRow[] {
  const groups = new Map<string, { name: string; items: LibraryItem[] }>();
  for (const item of items) {
    // Um jogo conta uma vez por linha, mesmo se a fonte repetir a tag.
    for (const tag of new Map(tagsOf(item).map((t) => [t.key, t])).values()) {
      const group = groups.get(tag.key) ?? { name: tag.name, items: [] };
      group.items.push(item);
      groups.set(tag.key, group);
    }
  }
  let entries = [...groups].map(([key, group]) => ({ key, name: group.name, items: group.items }));
  if (mergeSameGames) {
    const bySet = Map.groupBy(entries, (e) => e.items.map((i) => i.gameId).join(","));
    entries = [...bySet.values()].map((same) => {
      const sorted = same.toSorted((a, b) => a.name.length - b.name.length);
      const first = sorted[0]!;
      const name = mergeSameGames === "join" ? sorted.map((e) => e.name).join(" · ") : first.name;
      return { key: first.key, name, items: first.items };
    });
  }
  const rows = entries.map(({ key, name, items: members }) => toRow(key, name, members));
  return sortProfileRows(rows, "minutes").concat(rows.filter((r) => r.minutes === 0));
}

function toRow(key: string, name: string, members: LibraryItem[]): ProfileRow {
  const ratings = members.flatMap((m) => (m.rating === null ? [] : [m.rating]));
  const avg = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  return {
    key,
    name,
    minutes: members.reduce((sum, m) => sum + m.minutesPlayed, 0),
    games: members.length,
    finished: members.filter(isFinished).length,
    avgRating: avg === null ? null : Math.round(avg * 10) / 10,
    ratedGames: ratings.length,
    topGames: members
      .toSorted((a, b) => b.minutesPlayed - a.minutesPlayed)
      .slice(0, PROFILE_ROW_GAMES)
      .map(({ gameId, igdbId, name: gameName, coverImageId }) => ({
        gameId,
        igdbId,
        name: gameName,
        coverImageId,
      })),
  };
}

function companyCredits({ db }: UserScope, gameIds: number[]) {
  const byGame = new Map<number, { developers: Tag[]; publishers: Tag[] }>();
  if (gameIds.length === 0) return byGame;
  const rows = db
    .select({
      gameId: gameCompanies.gameId,
      igdbId: companies.igdbId,
      name: companies.name,
      developer: gameCompanies.developer,
      publisher: gameCompanies.publisher,
    })
    .from(gameCompanies)
    .innerJoin(companies, eq(companies.id, gameCompanies.companyId))
    .where(inArray(gameCompanies.gameId, gameIds))
    .all();
  for (const row of rows) {
    const credits = byGame.get(row.gameId) ?? { developers: [], publishers: [] };
    const tag = { key: String(row.igdbId), name: row.name };
    if (row.developer) credits.developers.push(tag);
    if (row.publisher) credits.publishers.push(tag);
    byGame.set(row.gameId, credits);
  }
  return byGame;
}

function seriesMemberships({ db }: UserScope, gameIds: number[]) {
  const byGame = new Map<number, { collection: Tag[]; franchise: Tag[] }>();
  if (gameIds.length === 0) return byGame;
  const rows = db
    .select({
      gameId: gameSeries.gameId,
      igdbId: series.igdbId,
      kind: series.kind,
      name: series.name,
    })
    .from(gameSeries)
    .innerJoin(series, eq(series.id, gameSeries.seriesId))
    .where(inArray(gameSeries.gameId, gameIds))
    .all();
  for (const row of rows) {
    const groups = byGame.get(row.gameId) ?? { collection: [], franchise: [] };
    groups[row.kind].push({ key: String(row.igdbId), name: row.name });
    byGame.set(row.gameId, groups);
  }
  return byGame;
}

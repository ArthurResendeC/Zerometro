import { and, eq, isNull, notInArray } from "drizzle-orm";
import type { AchievementSource } from "../../shared/achievements";
import { achievementSourceLabels } from "../../shared/achievements";
import type { Db } from "../db/client";
import { type AchievementSet, achievementSets, achievements } from "../db/schema";
import { AchievementSourceNotConfiguredError, NotFoundError } from "../errors";
import type { AchievementSourceApi, FetchedAchievementSet } from "./achievement-sources";
import type { Clock } from "./context";
import { createKvCache } from "./kv-cache";
import type { RaGameListEntry, RetroAchievementsApi } from "./retroachievements";

// As listas de conquistas das fontes, guardadas no banco e compartilhadas entre usuários (como
// o cache `games` do IGDB). Uma lista vence depois de 30 dias; atualizar mantém os desbloqueios
// (as conquistas são atualizadas no lugar) e marca como removida a que sumiu da fonte.

const DAY_MS = 24 * 60 * 60 * 1000;
export const SET_TTL_MS = 30 * DAY_MS;
/** A lista de jogos de um console do RA é grande e muda pouco. */
const RA_GAME_LIST_TTL_MS = 7 * DAY_MS;
const RA_GAME_LIST_CACHE_VERSION = 1;

export interface AchievementCatalog {
  /** Fontes com chave nesta instância (as outras somem da interface). */
  enabled: Record<AchievementSource, boolean>;
  /**
   * A lista guardada; busca na fonte se ainda não houver, se venceu ou se `force`. Se a fonte
   * falhar e houver uma versão guardada, devolve ela. NotFoundError se a fonte não tiver
   * conquistas para esse id.
   */
  ensureSet(
    source: AchievementSource,
    externalId: string,
    options?: { force?: boolean },
  ): Promise<AchievementSet>;
  /** Atualiza a lista em segundo plano se tiver vencido (sem esperar; erros vão para o log). */
  refreshIfStale(set: AchievementSet): void;
  /** Jogos com conquistas de um console do RA (cache de 7 dias no `kv`). */
  raGames(consoleId: number): Promise<RaGameListEntry[]>;
  /** Espera as atualizações em segundo plano (testes e scripts). */
  settled(): Promise<void>;
}

export interface AchievementCatalogOptions {
  db: Db;
  clock: Pick<Clock, "now">;
  steam: AchievementSourceApi;
  retroachievements: RetroAchievementsApi;
  onError?: (error: unknown, what: string) => void;
}

export function createAchievementCatalog({
  db,
  clock,
  steam,
  retroachievements,
  onError = (error, what) => console.error(`Falha ao atualizar ${what}:`, error),
}: AchievementCatalogOptions): AchievementCatalog {
  const apis: Record<AchievementSource, AchievementSourceApi> = { steam, retroachievements };
  const background = new Set<Promise<unknown>>();
  /** Uma busca em voo por lista: dois cliques em "Ligar" não buscam duas vezes. */
  const inFlight = new Map<string, Promise<AchievementSet>>();

  const raGameLists = createKvCache<number, RaGameListEntry[]>({
    db,
    clock,
    ttlMs: RA_GAME_LIST_TTL_MS,
    kvKey: (consoleId) => `ra:games:v${RA_GAME_LIST_CACHE_VERSION}:${consoleId}`,
    load: (consoleId) => retroachievements.getGameList(consoleId),
    isValid: (value): value is RaGameListEntry[] => Array.isArray(value),
    onError: (error, consoleId) => onError(error, `a lista de jogos do console ${consoleId} no RA`),
  });

  function find(source: AchievementSource, externalId: string): AchievementSet | null {
    return (
      db
        .select()
        .from(achievementSets)
        .where(and(eq(achievementSets.source, source), eq(achievementSets.externalId, externalId)))
        .get() ?? null
    );
  }

  const isStale = (set: AchievementSet) =>
    clock.now().getTime() - Date.parse(set.fetchedAt) >= SET_TTL_MS;

  function fetchAndSave(source: AchievementSource, externalId: string): Promise<AchievementSet> {
    const id = `${source}:${externalId}`;
    const running = inFlight.get(id);
    if (running) return running;
    const promise = (async () => {
      const numericId = Number(externalId);
      const fetched = Number.isSafeInteger(numericId)
        ? await apis[source].getAchievementSet(numericId)
        : null;
      if (!fetched) {
        throw new NotFoundError(
          `${achievementSourceLabels[source]} não tem conquistas para o jogo ${externalId}`,
        );
      }
      return saveSet(db, fetched, clock.now());
    })().finally(() => inFlight.delete(id));
    inFlight.set(id, promise);
    return promise;
  }

  return {
    enabled: { steam: steam.enabled, retroachievements: retroachievements.enabled },

    async ensureSet(source, externalId, options = {}) {
      const stored = find(source, externalId);
      if (stored && !options.force && !isStale(stored)) return stored;
      if (!apis[source].enabled) {
        // Fonte desligada nesta instância: vale o que já estiver guardado.
        if (stored) return stored;
        throw new AchievementSourceNotConfiguredError(
          achievementSourceLabels[source],
          source === "steam" ? "STEAM_WEB_API_KEY" : "RA_API_KEY",
        );
      }
      try {
        return await fetchAndSave(source, externalId);
      } catch (error) {
        // Fonte fora do ar: a lista guardada continua valendo.
        if (stored && !(error instanceof NotFoundError)) {
          onError(error, `a lista ${source}:${externalId}`);
          return stored;
        }
        throw error;
      }
    },

    refreshIfStale(set) {
      if (!isStale(set) || !apis[set.source].enabled) return;
      const promise = fetchAndSave(set.source, set.externalId)
        .catch((error: unknown) => onError(error, `a lista ${set.source}:${set.externalId}`))
        .finally(() => background.delete(promise));
      background.add(promise);
    },

    async raGames(consoleId) {
      return (await raGameLists.get(consoleId)).value;
    },

    async settled() {
      await Promise.allSettled([...background, raGameLists.settled()]);
    },
  };
}

/**
 * Grava (ou atualiza) a lista e as conquistas dela. Conquistas continuam com o mesmo id (e os
 * desbloqueios); a que sumiu da fonte ganha `removed_at`, e a que voltou perde.
 */
export function saveSet(db: Db, fetched: FetchedAchievementSet, now: Date): AchievementSet {
  const fetchedAt = now.toISOString();
  return db.transaction((tx) => {
    const values = { title: fetched.title, platform: fetched.platform, fetchedAt };
    const set = tx
      .insert(achievementSets)
      .values({ source: fetched.source, externalId: fetched.externalId, ...values })
      .onConflictDoUpdate({
        target: [achievementSets.source, achievementSets.externalId],
        set: values,
      })
      .returning()
      .get();

    for (const a of fetched.achievements) {
      const row = {
        title: a.title,
        description: a.description,
        iconUrl: a.iconUrl,
        iconLockedUrl: a.iconLockedUrl,
        rarity: a.rarity,
        points: a.points,
        hidden: a.hidden,
        sortOrder: a.sortOrder,
        removedAt: null,
      };
      tx.insert(achievements)
        .values({ setId: set.id, externalId: a.externalId, ...row })
        .onConflictDoUpdate({ target: [achievements.setId, achievements.externalId], set: row })
        .run();
    }

    const current = fetched.achievements.map((a) => a.externalId);
    tx.update(achievements)
      .set({ removedAt: fetchedAt })
      .where(
        and(
          eq(achievements.setId, set.id),
          isNull(achievements.removedAt),
          notInArray(achievements.externalId, current),
        ),
      )
      .run();
    return set;
  });
}

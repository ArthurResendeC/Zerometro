import { type Feed, type FeedGame, type FeedKey, feedKeys } from "../../shared/feeds";
import type { Db } from "../db/client";
import { IgdbNotConfiguredError } from "../errors";
import type { Clock } from "./context";
import type { IgdbApi } from "./igdb";
import { createKvCache, writeCached } from "./kv-cache";

// Listas do IGDB na tela inicial. Iguais para todos os usuários, guardadas no `kv` como
// `feed:<key>` e atualizadas no máximo 1x por dia. A home nunca espera o IGDB se já houver
// uma lista guardada: lista vencida é devolvida na hora e atualizada em segundo plano.

export interface FeedsService {
  /** Todas as listas, na ordem de `feedKeys`. Nunca falha: sem dados, a lista vem vazia. */
  getFeeds(): Promise<Feed[]>;
  /** Espera as atualizações em segundo plano terminarem (testes e scripts). */
  settled(): Promise<void>;
}

export interface FeedsServiceOptions {
  db: Db;
  igdb: IgdbApi;
  clock: Pick<Clock, "now">;
  ttlMs?: number;
  onError?: (error: unknown, key: FeedKey) => void;
}

export function createFeedsService({
  db,
  igdb,
  clock,
  ttlMs,
  onError = (error, key) => console.error(`Falha ao atualizar a lista "${key}" do IGDB:`, error),
}: FeedsServiceOptions): FeedsService {
  const cache = createKvCache<FeedKey, FeedGame[]>({
    db,
    clock,
    ttlMs,
    kvKey,
    load: (key) => igdb.getFeed(key, clock.now()),
    isValid: (value): value is FeedGame[] => Array.isArray(value),
    onError: (error, key) => {
      // Sem credenciais é uma escolha (ex.: demo), não um erro.
      if (!(error instanceof IgdbNotConfiguredError)) onError(error, key);
    },
  });

  async function getFeed(key: FeedKey): Promise<Feed> {
    try {
      const { value, updatedAt } = await cache.get(key);
      return { key, games: value, updatedAt };
    } catch {
      return { key, games: [], updatedAt: null };
    }
  }

  return {
    getFeeds: () => Promise.all(feedKeys.map(getFeed)),
    settled: () => cache.settled(),
  };
}

function kvKey(key: FeedKey): string {
  return `feed:${key}`;
}

/** Grava uma lista direto no cache (seed do demo, que roda sem credenciais do IGDB). */
export function saveFeedSnapshot(db: Db, key: FeedKey, games: FeedGame[], updatedAt: Date): void {
  writeCached(db, kvKey(key), games, updatedAt);
}

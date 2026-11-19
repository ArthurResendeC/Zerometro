import { type Feed, type FeedGame, type FeedKey, feedKeys } from "../../shared/feeds";
import type { Db } from "../db/client";
import { IgdbNotConfiguredError } from "../errors";
import type { Clock } from "./context";
import type { IgdbApi } from "./igdb";
import { getKv, setKv } from "./kv";

// Listas do IGDB na tela inicial. Iguais para todos os usuários, guardadas no `kv` como
// `feed:<key>` e atualizadas no máximo 1x por dia. A home nunca espera o IGDB se já houver
// uma lista guardada: lista vencida é devolvida na hora e atualizada em segundo plano.

const DAY_MS = 24 * 60 * 60 * 1000;
/** Depois de uma falha no IGDB, espera um pouco antes de tentar de novo a mesma lista. */
const RETRY_AFTER_MS = 10 * 60 * 1000;

interface Snapshot {
  games: FeedGame[];
  updatedAt: string;
}

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
  ttlMs = DAY_MS,
  onError = (error, key) => console.error(`Falha ao atualizar a lista "${key}" do IGDB:`, error),
}: FeedsServiceOptions): FeedsService {
  /** Uma atualização em voo por lista. */
  const inFlight = new Map<FeedKey, Promise<Snapshot | null>>();
  const lastFailure = new Map<FeedKey, number>();

  function refresh(key: FeedKey): Promise<Snapshot | null> {
    const running = inFlight.get(key);
    if (running) return running;

    const failedAt = lastFailure.get(key);
    if (failedAt !== undefined && clock.now().getTime() - failedAt < RETRY_AFTER_MS) {
      return Promise.resolve(null);
    }

    const promise = igdb
      .getFeed(key, clock.now())
      .then((games) => {
        const snapshot = { games, updatedAt: clock.now().toISOString() };
        setKv(db, kvKey(key), JSON.stringify(snapshot));
        lastFailure.delete(key);
        return snapshot;
      })
      .catch((error: unknown) => {
        lastFailure.set(key, clock.now().getTime());
        // Sem credenciais é uma escolha (ex.: demo), não um erro.
        if (!(error instanceof IgdbNotConfiguredError)) onError(error, key);
        return null;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  }

  async function getFeed(key: FeedKey): Promise<Feed> {
    const stored = readSnapshot(db, key);
    if (!stored) {
      const fresh = await refresh(key);
      return { key, games: fresh?.games ?? [], updatedAt: fresh?.updatedAt ?? null };
    }
    const age = clock.now().getTime() - Date.parse(stored.updatedAt);
    if (!(age < ttlMs)) void refresh(key);
    return { key, ...stored };
  }

  return {
    getFeeds: () => Promise.all(feedKeys.map(getFeed)),
    async settled() {
      await Promise.all(inFlight.values());
    },
  };
}

function kvKey(key: FeedKey): string {
  return `feed:${key}`;
}

function readSnapshot(db: Db, key: FeedKey): Snapshot | null {
  const raw = getKv(db, kvKey(key));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Snapshot>;
    return Array.isArray(parsed.games) && typeof parsed.updatedAt === "string"
      ? { games: parsed.games, updatedAt: parsed.updatedAt }
      : null;
  } catch {
    return null;
  }
}

/** Grava uma lista direto no cache (seed do demo, que roda sem credenciais do IGDB). */
export function saveFeedSnapshot(db: Db, key: FeedKey, games: FeedGame[], updatedAt: Date): void {
  setKv(db, kvKey(key), JSON.stringify({ games, updatedAt: updatedAt.toISOString() }));
}

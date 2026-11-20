import type { Db } from "../db/client";
import type { Clock } from "./context";
import { getKv, setKv } from "./kv";

// Cache no `kv` para dados do IGDB, compartilhado entre usuários, com stale-while-revalidate:
// valor vencido é devolvido na hora e atualizado em segundo plano. Só espera o IGDB quando
// ainda não há nada guardado.

const DAY_MS = 24 * 60 * 60 * 1000;
/** Depois de uma falha, espera um pouco antes de tentar de novo a mesma chave. */
const RETRY_AFTER_MS = 10 * 60 * 1000;

export interface Cached<T> {
  value: T;
  /** Quando foi buscado (ISO). */
  updatedAt: string;
}

export interface KvCache<K, T> {
  /**
   * O valor guardado (vencido ou não). Sem nada guardado, busca e espera; se a busca falhar
   * (ou tiver falhado há pouco), lança o erro.
   */
  get(key: K): Promise<Cached<T>>;
  /** Espera as atualizações em segundo plano terminarem (testes e scripts). */
  settled(): Promise<void>;
}

export interface KvCacheOptions<K, T> {
  db: Db;
  clock: Pick<Clock, "now">;
  /** Chave no `kv` (ponha uma versão se o formato puder mudar). */
  kvKey: (key: K) => string;
  load: (key: K) => Promise<T>;
  /** Confere o JSON guardado; formato inválido conta como vazio. */
  isValid: (value: unknown) => value is T;
  /** Cada falha real ao buscar, em primeiro ou segundo plano. */
  onError: (error: unknown, key: K) => void;
  ttlMs?: number;
  retryAfterMs?: number;
}

export function createKvCache<K, T>({
  db,
  clock,
  kvKey,
  load,
  isValid,
  onError,
  ttlMs = DAY_MS,
  retryAfterMs = RETRY_AFTER_MS,
}: KvCacheOptions<K, T>): KvCache<K, T> {
  /** Uma busca em voo por chave. */
  const inFlight = new Map<string, Promise<Cached<T>>>();
  const lastFailure = new Map<string, { at: number; error: unknown }>();

  function save(key: K, value: T, updatedAt: Date): Cached<T> {
    return writeCached(db, kvKey(key), value, updatedAt);
  }

  function read(key: K): Cached<T> | null {
    const raw = getKv(db, kvKey(key));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<Cached<unknown>>;
      return typeof parsed.updatedAt === "string" && isValid(parsed.value)
        ? { value: parsed.value, updatedAt: parsed.updatedAt }
        : null;
    } catch {
      return null;
    }
  }

  function refresh(key: K): Promise<Cached<T>> {
    const id = kvKey(key);
    const running = inFlight.get(id);
    if (running) return running;

    const failure = lastFailure.get(id);
    if (failure && clock.now().getTime() - failure.at < retryAfterMs) {
      return Promise.reject(failure.error);
    }

    const promise = load(key)
      .then((value) => {
        lastFailure.delete(id);
        return save(key, value, clock.now());
      })
      .catch((error: unknown) => {
        lastFailure.set(id, { at: clock.now().getTime(), error });
        onError(error, key);
        throw error;
      })
      .finally(() => inFlight.delete(id));
    inFlight.set(id, promise);
    return promise;
  }

  return {
    async get(key) {
      const stored = read(key);
      if (!stored) return refresh(key);
      const age = clock.now().getTime() - Date.parse(stored.updatedAt);
      // O erro já foi para o onError; o valor vencido continua valendo.
      if (!(age < ttlMs)) refresh(key).catch(() => {});
      return stored;
    },
    async settled() {
      await Promise.allSettled(inFlight.values());
    },
  };
}

/** Grava no formato do cache (para scripts que não montam o service, como o seed do demo). */
export function writeCached<T>(db: Db, kvKey: string, value: T, updatedAt: Date): Cached<T> {
  const entry = { value, updatedAt: updatedAt.toISOString() };
  setKv(db, kvKey, JSON.stringify(entry));
  return entry;
}

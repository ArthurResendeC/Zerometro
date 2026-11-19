import type { Db } from "../../db/client";
import { IgdbError, IgdbNotConfiguredError } from "../../errors";
import { deleteKv, getKv, setKv } from "../kv";

// Cliente HTTP de baixo nível do IGDB: token da Twitch (client credentials), rate limit e retry.

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const API_URL = "https://api.igdb.com/v4";
/** Renova o token com folga (ele dura ~60 dias). */
const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;
/** O IGDB permite 4 req/s; um pouco de margem. */
const DEFAULT_MIN_INTERVAL_MS = 260;
const TOKEN_KV_KEY = "igdb.token";

export interface StoredToken {
  accessToken: string;
  /** Epoch em ms. */
  expiresAt: number;
}

export interface TokenStore {
  load(): StoredToken | null;
  save(token: StoredToken): void;
  clear(): void;
}

export interface IgdbClient {
  /** POST em /v4/<endpoint> com uma query Apicalypse. */
  query<T>(endpoint: string, body: string): Promise<T>;
}

export interface IgdbClientOptions {
  clientId: string;
  clientSecret: string;
  tokenStore: TokenStore;
  fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  minIntervalMs?: number;
}

export function createIgdbClient(options: IgdbClientOptions): IgdbClient {
  const { clientId, clientSecret, tokenStore } = options;
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? Bun.sleep;
  const throttle = createThrottle(options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS, now, sleep);

  let pendingToken: Promise<string> | null = null;

  function getToken(): Promise<string> {
    const cached = tokenStore.load();
    if (cached && cached.expiresAt - now() > REFRESH_MARGIN_MS) {
      return Promise.resolve(cached.accessToken);
    }
    // Requisições simultâneas compartilham a mesma renovação.
    pendingToken ??= requestToken().finally(() => {
      pendingToken = null;
    });
    return pendingToken;
  }

  async function requestToken(): Promise<string> {
    const res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
    });
    if (!res.ok) {
      throw new IgdbError(`Falha ao obter token da Twitch (HTTP ${res.status})`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    const token = { accessToken: data.access_token, expiresAt: now() + data.expires_in * 1000 };
    tokenStore.save(token);
    return token.accessToken;
  }

  async function send(endpoint: string, body: string): Promise<Response> {
    const token = await getToken();
    await throttle();
    return fetchFn(`${API_URL}/${endpoint}`, {
      method: "POST",
      headers: {
        "Client-ID": clientId,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "text/plain",
      },
      body,
    });
  }

  return {
    async query<T>(endpoint: string, body: string): Promise<T> {
      let res: Response;
      try {
        res = await send(endpoint, body);
        if (res.status === 401) {
          // Token revogado ou expirado antes do previsto: renova uma vez.
          tokenStore.clear();
          res = await send(endpoint, body);
        } else if (res.status === 429) {
          await sleep(1000);
          res = await send(endpoint, body);
        }
      } catch (error) {
        if (error instanceof IgdbError) throw error;
        throw new IgdbError(`Falha de rede ao chamar o IGDB (/${endpoint})`, { cause: error });
      }

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        throw new IgdbError(`IGDB respondeu HTTP ${res.status} em /${endpoint}: ${detail}`);
      }
      return (await res.json()) as T;
    },
  };
}

/** Client usado quando faltam credenciais: falha com uma mensagem clara. */
export function createDisabledIgdbClient(): IgdbClient {
  return {
    query() {
      return Promise.reject(new IgdbNotConfiguredError());
    },
  };
}

/** Guarda o token na tabela `kv`, para sobreviver a reinícios. */
export function createKvTokenStore(db: Db): TokenStore {
  return {
    load() {
      const raw = getKv(db, TOKEN_KV_KEY);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as Partial<StoredToken>;
        return typeof parsed.accessToken === "string" && typeof parsed.expiresAt === "number"
          ? { accessToken: parsed.accessToken, expiresAt: parsed.expiresAt }
          : null;
      } catch {
        return null;
      }
    },
    save(token) {
      setKv(db, TOKEN_KV_KEY, JSON.stringify(token));
    },
    clear() {
      deleteKv(db, TOKEN_KV_KEY);
    },
  };
}

export function createMemoryTokenStore(initial: StoredToken | null = null): TokenStore {
  let token = initial;
  return {
    load: () => token,
    save: (next) => {
      token = next;
    },
    clear: () => {
      token = null;
    },
  };
}

/**
 * Garante um intervalo mínimo entre o início das requisições.
 * A reserva do horário é síncrona, então chamadas concorrentes formam uma fila.
 */
export function createThrottle(
  minIntervalMs: number,
  now: () => number,
  sleep: (ms: number) => Promise<unknown>,
): () => Promise<void> {
  let nextSlot = 0;
  return async () => {
    const current = now();
    const slot = Math.max(current, nextSlot);
    nextSlot = slot + minIntervalMs;
    if (slot > current) await sleep(slot - current);
  };
}

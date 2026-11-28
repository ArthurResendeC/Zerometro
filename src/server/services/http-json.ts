import { AchievementSourceError, AppError } from "../errors";
import { createRequestGate, parseRetryAfter, type RequestGate } from "./rate-gate";

// GET de JSON para APIs públicas com chave na URL (Steam, RetroAchievements): intervalo mínimo
// entre chamadas, timeout e o 429 tratado com calma (ver `rate-gate.ts`). As mensagens de erro
// citam só o caminho, nunca a URL completa, para a chave não ir parar em logs.

export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface JsonClientOptions {
  /** Nome da fonte nas mensagens de erro (ex.: "Steam"). */
  label: string;
  baseUrl: string;
  /** Parâmetros enviados em toda chamada (ex.: a chave). */
  defaultParams?: Record<string, string>;
  /** Intervalo mínimo entre chamadas (sem `gate`). */
  minIntervalMs?: number;
  /** Porteiro compartilhado com outros clientes da mesma chave (ex.: os dois da Steam). */
  gate?: RequestGate;
  timeoutMs?: number;
  fetch?: FetchFn;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
}

export interface JsonGetOptions {
  /** Status de erro cujo corpo ainda interessa (ex.: a Steam explica o 403 no JSON). */
  acceptStatus?: number[];
}

export interface JsonClient {
  get<T>(
    path: string,
    params?: Record<string, string | number>,
    options?: JsonGetOptions,
  ): Promise<T>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
/** Sem `Retry-After`, espera isto e tenta mais uma vez. */
const RETRY_AFTER_429_MS = 1000;
/** Um `Retry-After` maior que isto não vale esperar com a requisição aberta: pausa a fonte. */
const MAX_INLINE_WAIT_MS = 5000;

export function createJsonClient(options: JsonClientOptions): JsonClient {
  const { label, baseUrl, defaultParams = {} } = options;
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? Bun.sleep;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const gate =
    options.gate ??
    createRequestGate({ label, minIntervalMs: options.minIntervalMs ?? 0, now, sleep });

  async function send(url: URL): Promise<Response> {
    await gate.acquire();
    return fetchFn(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  return {
    async get<T>(
      path: string,
      params: Record<string, string | number> = {},
      { acceptStatus = [] }: JsonGetOptions = {},
    ): Promise<T> {
      const url = new URL(path, baseUrl);
      for (const [key, value] of Object.entries({ ...defaultParams, ...params })) {
        url.searchParams.set(key, String(value));
      }

      let res: Response;
      try {
        res = await send(url);
        if (res.status === 429) {
          const wait = parseRetryAfter(res.headers.get("retry-after"), now());
          if (wait !== null && wait > MAX_INLINE_WAIT_MS) throw gate.rateLimited(wait);
          await sleep(wait ?? RETRY_AFTER_429_MS);
          res = await send(url);
          if (res.status === 429) {
            throw gate.rateLimited(parseRetryAfter(res.headers.get("retry-after"), now()));
          }
        }
      } catch (error) {
        // A pausa da fonte (SourceRateLimitedError) passa como está.
        if (error instanceof AppError) throw error;
        throw new AchievementSourceError(`Falha de rede ao chamar ${label} (${path})`, {
          cause: error,
        });
      }
      gate.succeeded();

      if (!res.ok && !acceptStatus.includes(res.status)) {
        throw new AchievementSourceError(`${label} respondeu HTTP ${res.status} em ${path}`);
      }
      try {
        return (await res.json()) as T;
      } catch (error) {
        throw new AchievementSourceError(`${label} devolveu uma resposta inválida em ${path}`, {
          cause: error,
        });
      }
    },
  };
}

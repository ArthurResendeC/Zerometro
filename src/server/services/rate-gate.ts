import { SourceRateLimitedError } from "../errors";
import { createThrottle } from "./throttle";

// Porteiro de uma API externa: o intervalo mínimo entre chamadas (uma fila só para todos os
// clientes que dividem a mesma chave) e um disjuntor. Quando a fonte insiste no 429, a instância
// para de chamar por um tempo, para todos os perfis, em vez de seguir tentando jogo a jogo: 5min
// na primeira vez, dobrando a cada nova recusa seguida (até 1h), ou o `Retry-After`, se for maior.

export interface RequestGate {
  /** Espera a vez. SourceRateLimitedError se a fonte pediu pausa (sem chamar nada). */
  acquire(): Promise<void>;
  /** A fonte recusou de novo: abre o disjuntor e devolve o erro para lançar. */
  rateLimited(retryAfterMs: number | null): SourceRateLimitedError;
  /** Uma resposta normal: a próxima recusa volta a pausar só 5min. */
  succeeded(): void;
  /** Até quando está em pausa (null = liberado). */
  pausedUntil(): Date | null;
}

export interface RequestGateOptions {
  /** Nome da fonte na mensagem (ex.: "a Steam"). */
  label: string;
  minIntervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  basePauseMs?: number;
  maxPauseMs?: number;
}

const BASE_PAUSE_MS = 5 * 60_000;
const MAX_PAUSE_MS = 60 * 60_000;

export function createRequestGate(options: RequestGateOptions): RequestGate {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? Bun.sleep;
  const basePauseMs = options.basePauseMs ?? BASE_PAUSE_MS;
  const maxPauseMs = options.maxPauseMs ?? MAX_PAUSE_MS;
  const throttle = createThrottle(options.minIntervalMs, now, sleep);
  let pausedUntilMs = 0;
  /** Recusas seguidas (zera na primeira resposta normal). */
  let strikes = 0;

  const pausedUntil = () => (now() < pausedUntilMs ? new Date(pausedUntilMs) : null);
  const failIfPaused = () => {
    const until = pausedUntil();
    if (until) throw new SourceRateLimitedError(options.label, until);
  };

  return {
    async acquire() {
      failIfPaused();
      await throttle();
      // Quem estava na fila quando o disjuntor abriu também desiste.
      failIfPaused();
    },
    rateLimited(retryAfterMs) {
      strikes++;
      const backoff = Math.min(maxPauseMs, basePauseMs * 2 ** (strikes - 1));
      pausedUntilMs = Math.max(pausedUntilMs, now() + Math.max(backoff, retryAfterMs ?? 0));
      return new SourceRateLimitedError(options.label, new Date(pausedUntilMs));
    },
    succeeded() {
      strikes = 0;
    },
    pausedUntil,
  };
}

/** O `Retry-After` em ms: segundos ou uma data HTTP. null se não veio ou não dá para ler. */
export function parseRetryAfter(header: string | null, nowMs: number): number | null {
  const value = header?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

// Limite de tentativas erradas (login, convite, consentimento do OAuth), em memória: uma réplica
// só, e um restart zerar a contagem não é problema.

export interface AttemptLimiter {
  /** Ainda pode tentar com essa chave? */
  allowed: (key: string) => boolean;
  /** Conta uma tentativa errada. */
  fail: (key: string) => void;
  /** Acertou: zera a chave. */
  reset: (key: string) => void;
}

export function createAttemptLimiter({
  max = 10,
  windowMs = 15 * 60 * 1000,
  now = Date.now,
}: { max?: number; windowMs?: number; now?: () => number } = {}): AttemptLimiter {
  const failures = new Map<string, { count: number; since: number }>();
  const current = (key: string) => {
    const entry = failures.get(key);
    if (entry && now() - entry.since >= windowMs) {
      failures.delete(key);
      return undefined;
    }
    return entry;
  };
  return {
    allowed: (key) => (current(key)?.count ?? 0) < max,
    fail: (key) => {
      const entry = current(key);
      if (entry) entry.count += 1;
      else failures.set(key, { count: 1, since: now() });
      // Não deixa o mapa crescer sem fim com chaves velhas.
      if (failures.size > 10_000) {
        for (const [k, v] of failures) if (now() - v.since >= windowMs) failures.delete(k);
      }
    },
    reset: (key) => {
      failures.delete(key);
    },
  };
}

/** IP de quem chamou, pelo proxy da Railway (ou "local" sem proxy). */
export const clientIp = (headers: Headers) =>
  headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

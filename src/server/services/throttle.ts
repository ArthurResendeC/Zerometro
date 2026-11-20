// Intervalo mínimo entre requisições, compartilhado pelos clientes de APIs externas.

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

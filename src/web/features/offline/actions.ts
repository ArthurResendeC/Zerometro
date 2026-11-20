import type { QueryClient } from "@tanstack/react-query";
import { DEFAULT_TIME_ZONE } from "@shared/dates";
import type { LibraryItem } from "@shared/library";
import type { ActiveSession } from "@shared/timer";
import { ApiError } from "@/lib/api";
import type { AuthSession } from "@/lib/auth-client";
import {
  type EffectiveTimer,
  type GameRef,
  type OutboxItem,
  type OutboxOp,
  effectiveTimer,
} from "./outbox-core";
import { useOutbox, userItems } from "./outbox";

// Peças usadas pelos hooks de escrita (lib/queries.ts) para decidir entre enviar agora ou pôr
// na fila, e para montar os itens. Sem importar lib/queries.ts (evita import circular).

/** Requisições diretas desistem depois disso e vão para a fila (internet ruim). */
const REQUEST_TIMEOUT_MS = 15_000;
export const requestOptions = () => ({ init: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) } });

let syncTrigger: () => void = () => {};
/** Registrado por ./sync.ts no boot; os hooks só pedem "sincroniza quando der". */
export function setSyncTrigger(trigger: () => void) {
  syncTrigger = trigger;
}
export const requestSync = () => syncTrigger();

export const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

export function currentUserId(queryClient: QueryClient): string | undefined {
  return queryClient.getQueryData<AuthSession | null>(["auth", "session"])?.user.id;
}

/**
 * Vai para a fila em vez de enviar agora: sem conexão, ou com algo do usuário ainda na fila
 * (a ordem importa: um "Comecei" não pode passar na frente de um "Parei" pendente).
 */
export function mustQueue(userId: string | undefined) {
  if (!userId) return false;
  return isOffline() || userItems(userId).some((item) => item.status === "pending");
}

/** Falha de conexão (sem rede, timeout, servidor/proxy fora do ar), não uma recusa da API. */
export function isConnectionError(error: unknown) {
  if (!(error instanceof ApiError)) return error instanceof TypeError || isAbort(error);
  return [408, 429, 500, 502, 503, 504].includes(error.status);
}

const isAbort = (error: unknown) =>
  error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError");

/** Agora, pelo relógio do servidor (diferença medida na última consulta ao timer). */
export function serverNow(queryClient: QueryClient): Date {
  const offset = queryClient.getQueryData<{ clockOffsetMs: number }>(["timer"])?.clockOffsetMs ?? 0;
  return new Date(Date.now() + offset);
}

/** Nome, capa e link do jogo a partir do cache da biblioteca (funciona offline). */
export function findGame(queryClient: QueryClient, gameId: number): GameRef {
  for (const [, data] of queryClient.getQueriesData<unknown>({ queryKey: ["library"] })) {
    const candidates: unknown[] =
      data && typeof data === "object" && "items" in data && Array.isArray(data.items)
        ? data.items
        : [data];
    const item = candidates.find(
      (c): c is LibraryItem =>
        typeof c === "object" && c !== null && (c as LibraryItem).gameId === gameId,
    );
    if (item) {
      return { gameId, igdbId: item.igdbId, name: item.name, coverImageId: item.coverImageId };
    }
  }
  return { gameId, igdbId: 0, name: "Jogo", coverImageId: null };
}

/** Timer mostrado agora: o do servidor (em cache) com o que está na fila aplicado por cima. */
export function currentTimer(queryClient: QueryClient): EffectiveTimer | null {
  const userId = currentUserId(queryClient);
  const server = queryClient.getQueryData<{ active: ActiveSession | null }>(["timer"])?.active;
  return effectiveTimer(server ?? null, userId ? userItems(userId) : [], DEFAULT_TIME_ZONE);
}

export const gameOf = (timer: EffectiveTimer): GameRef => ({
  gameId: timer.gameId,
  igdbId: timer.igdbId,
  name: timer.gameName,
  coverImageId: timer.coverImageId,
});

/** Põe na fila e pede para sincronizar (se houver conexão, vai na hora, em ordem). */
export function enqueue(
  userId: string,
  op: OutboxOp,
  { id = newClientId(), dependsOn }: { id?: string; dependsOn?: string } = {},
): OutboxItem {
  const item: OutboxItem = {
    id,
    userId,
    createdAt: new Date().toISOString(),
    op,
    status: "pending",
    ...(dependsOn && { dependsOn }),
  };
  useOutbox.getState().enqueue(item);
  requestSync();
  return item;
}

/** Descarta da fila (ex.: cancelar um timer que nem chegou ao servidor). */
export function discardQueued(id: string) {
  useOutbox.getState().discard(id);
}

export const newClientId = () => crypto.randomUUID();

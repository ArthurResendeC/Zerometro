// Núcleo da fila offline (outbox), sem React nem navegador: tipos, o timer "efetivo" (o do
// servidor com as operações pendentes aplicadas por cima) e a sincronização com o envio injetado.

import { zonedParts } from "@shared/dates";
import type { LogSessionResult } from "@shared/sessions";
import type { ActiveSession, StartTimerResult, StopTimerResult, TimerTarget } from "@shared/timer";

/** O suficiente do jogo para mostrar a operação (nome, capa, link) sem a API. */
export interface GameRef {
  gameId: number;
  igdbId: number;
  name: string;
  coverImageId: string | null;
}

export type OutboxOp =
  | {
      kind: "log";
      game: GameRef;
      input: { gameId: number; minutes: number; playedOn: string; note?: string; clientId: string };
    }
  | {
      kind: "timer.start";
      game: GameRef;
      /** Sempre com `replaceActive`: uma pessoa não joga dois jogos ao mesmo tempo. */
      input: { gameId: number; startedAt: string; clientId: string; replaceActive: true };
    }
  | {
      kind: "timer.stop";
      game: GameRef;
      /** Início do timer parado, para mostrar a duração na lista de pendentes. */
      startedAt: string;
      input: { target: TimerTarget; endedAt: string; note?: string };
    }
  | { kind: "timer.cancel"; game: GameRef; target: TimerTarget };

export interface OutboxItem {
  /** Id do item; em `log` e `timer.start` é também o `clientId` mandado ao servidor. */
  id: string;
  /** Dono: a fila é do aparelho, mas só sincroniza os itens de quem está logado. */
  userId: string;
  createdAt: string;
  op: OutboxOp;
  status: "pending" | "failed";
  /** Motivo da recusa (status `failed`). */
  error?: string;
  /** Stop/cancel de um timer que começou offline: depende do start pendente. */
  dependsOn?: string;
}

/** Timer mostrado no app: o do servidor ou um iniciado offline que ainda não chegou lá. */
export interface EffectiveTimer extends ActiveSession {
  /** Ainda só neste aparelho (o start está na fila). */
  pending: boolean;
  /** Como apontar para ele num stop/cancel. */
  target: TimerTarget;
  /** Item da fila que o criou (timers pendentes). */
  outboxId?: string;
}

export function fromServer(active: ActiveSession): EffectiveTimer {
  return { ...active, pending: false, target: { id: active.id } };
}

const sameTarget = (a: TimerTarget, b: TimerTarget) =>
  "id" in a ? "id" in b && a.id === b.id : "clientId" in b && a.clientId === b.clientId;

/** O timer do servidor (em cache) com as operações pendentes aplicadas, em ordem. */
export function effectiveTimer(
  server: ActiveSession | null,
  items: readonly OutboxItem[],
  timeZone: string,
): EffectiveTimer | null {
  let active = server ? fromServer(server) : null;
  for (const item of items) {
    if (item.status !== "pending") continue;
    const { op } = item;
    if (op.kind === "timer.start") {
      if (active?.gameId === op.game.gameId) continue; // mesmo jogo: o servidor mantém o que roda
      active = {
        id: 0,
        gameId: op.game.gameId,
        igdbId: op.game.igdbId,
        gameName: op.game.name,
        coverImageId: op.game.coverImageId,
        playedOn: zonedParts(new Date(op.input.startedAt), timeZone).date,
        startedAt: op.input.startedAt,
        note: null,
        pending: true,
        target: { clientId: op.input.clientId },
        outboxId: item.id,
      };
    } else if (op.kind === "timer.stop" || op.kind === "timer.cancel") {
      const target = op.kind === "timer.stop" ? op.input.target : op.target;
      if (active && sameTarget(active.target, target)) active = null;
    }
  }
  return active;
}

// ---------------------------------------------------------------------------
// Sincronização

/** Erro HTTP da API (o `ApiError` do cliente), sem depender dele aqui. */
export interface HttpError {
  status: number;
  message: string;
}

export const isHttpError = (error: unknown): error is HttpError =>
  typeof error === "object" &&
  error !== null &&
  typeof (error as HttpError).status === "number" &&
  typeof (error as HttpError).message === "string";

/** Status que indicam problema passageiro (servidor/proxy fora do ar): tentar de novo depois. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export type SendResult =
  | { kind: "log"; result: LogSessionResult }
  | { kind: "timer.start"; result: StartTimerResult }
  | { kind: "timer.stop"; result: StopTimerResult }
  | { kind: "timer.cancel" }
  /** Stop/cancel de algo que não existe mais (já foi feito): nada a fazer. */
  | { kind: "gone" };

export interface SyncCallbacks {
  send: (item: OutboxItem) => Promise<SendResult>;
  onSent: (item: OutboxItem, result: SendResult) => void;
  onFailed: (item: OutboxItem, error: string) => void;
}

export type SyncStop = "network" | "unauthorized" | null;

/**
 * Envia os itens pendentes em ordem, um por vez.
 * - enviado → `onSent` (sai da fila);
 * - recusado (4xx) → `onFailed` com o motivo, e os stop/cancel que dependem dele falham junto;
 * - 404 em stop/cancel → já tinha sido feito: conta como enviado (`gone`);
 * - 401 → para (precisa entrar de novo); rede/5xx → para e tenta depois.
 */
export async function syncItems(
  items: readonly OutboxItem[],
  { send, onSent, onFailed }: SyncCallbacks,
): Promise<{ stoppedBy: SyncStop }> {
  const failed = new Set<string>();
  for (const item of items) {
    if (item.status !== "pending") continue;
    if (item.dependsOn && failed.has(item.dependsOn)) {
      failed.add(item.id);
      onFailed(item, "O início deste timer não foi aceito pelo servidor");
      continue;
    }
    try {
      // Um de cada vez, em ordem: o stop não pode passar na frente do start.
      // oxlint-disable-next-line no-await-in-loop
      onSent(item, await send(item));
    } catch (error) {
      if (!isHttpError(error)) return { stoppedBy: "network" };
      if (error.status === 401) return { stoppedBy: "unauthorized" };
      if (RETRYABLE_STATUS.has(error.status)) return { stoppedBy: "network" };
      if (
        error.status === 404 &&
        (item.op.kind === "timer.stop" || item.op.kind === "timer.cancel")
      ) {
        onSent(item, { kind: "gone" });
        continue;
      }
      failed.add(item.id);
      onFailed(item, error.message);
    }
  }
  return { stoppedBy: null };
}

/** Sessões gravadas por um envio (para o resumo "2 sessões sincronizadas"). */
export function savedSession(result: SendResult): LogSessionResult | null {
  if (result.kind === "log") return result.result.alreadySaved ? null : result.result;
  if (result.kind === "timer.stop" && !result.result.discarded) {
    return result.result.alreadySaved ? null : result.result;
  }
  if (result.kind === "timer.start" && result.result.stopped && !result.result.stopped.discarded) {
    return result.result.stopped;
  }
  return null;
}

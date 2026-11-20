import { z } from "zod";
import { localTimeSchema } from "./dates";
import type { GameStatus } from "./domain";
import { type LogSessionResult, noteSchema } from "./sessions";

// Contrato do timer de sessão (o timer vive no servidor; o cliente só mostra o tempo decorrido).

export interface ActiveSession {
  id: number;
  gameId: number;
  /** Id no IGDB: é por ele que a página do jogo é aberta. */
  igdbId: number;
  gameName: string;
  coverImageId: string | null;
  /** Dia em que começou: a sessão inteira conta nele, mesmo passando da meia-noite. */
  playedOn: string;
  /** ISO UTC. */
  startedAt: string;
  note: string | null;
}

export interface TimerState {
  active: ActiveSession | null;
  /** Hora do servidor (ISO), para o cliente corrigir diferença de relógio. */
  now: string;
}

export const startTimerSchema = z.object({
  gameId: z.number().int().positive(),
  /** Se já houver outro jogo rodando: encerra ele e começa este. Sem isso → 409 `timer_active`. */
  replaceActive: z.boolean().optional(),
});
export type StartTimerInput = z.infer<typeof startTimerSchema>;

export const stopTimerSchema = z.object({
  /** Horário local (HH:MM) em que parou, para quando esqueceu o timer ligado. Padrão: agora. */
  endTime: localTimeSchema.optional(),
  note: noteSchema.optional(),
});
export type StopTimerInput = z.infer<typeof stopTimerSchema>;

export type StopTimerResult =
  | { discarded: true; gameName: string }
  | ({ discarded: false } & LogSessionResult);

export interface StartTimerResult {
  active: ActiveSession;
  /** Já estava rodando neste jogo (nada mudou). */
  alreadyRunning: boolean;
  /** Sessão encerrada ao trocar de jogo. */
  stopped: StopTimerResult | null;
  statusChangedTo: GameStatus | null;
}

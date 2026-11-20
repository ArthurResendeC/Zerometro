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

/** Instante exato (ISO com fuso), para a fila offline mandar o horário real de cada ação. */
const instantSchema = z.iso.datetime({ offset: true });

/** Qual timer: pelo id (começou online) ou pelo `clientId` do start (começou offline). */
export const timerTargetSchema = z.union([
  z.object({ id: z.number().int().positive() }),
  z.object({ clientId: z.uuid() }),
]);
export type TimerTarget = z.infer<typeof timerTargetSchema>;

export const startTimerSchema = z.object({
  gameId: z.number().int().positive(),
  /**
   * Se já houver outro jogo rodando: encerra ele (no instante deste início) e começa este.
   * Sem isso → 409 `timer_active`.
   */
  replaceActive: z.boolean().optional(),
  /** Quando começou (fila offline). Padrão: agora. Não pode ser no futuro. */
  startedAt: instantSchema.optional(),
  /** UUID gerado no aparelho: reenviar não cria outro timer, e o stop/cancel pode apontar para ele. */
  clientId: z.uuid().optional(),
});
export type StartTimerInput = z.infer<typeof startTimerSchema>;

export const stopTimerSchema = z
  .object({
    /** Horário local (HH:MM) em que parou, para quando esqueceu o timer ligado. Padrão: agora. */
    endTime: localTimeSchema.optional(),
    /** Instante exato em que parou (fila offline); mesma regra do "agora" (menos de 1min descarta). */
    endedAt: instantSchema.optional(),
    /**
     * Timer a parar. Se ele já foi parado (outro aparelho, reenvio), devolve a sessão gravada
     * (`alreadySaved`); se não existe mais, 404. Padrão: o que estiver rodando.
     */
    target: timerTargetSchema.optional(),
    note: noteSchema.optional(),
  })
  .refine((v) => !(v.endTime && v.endedAt), "Use endTime ou endedAt, não os dois");
export type StopTimerInput = z.infer<typeof stopTimerSchema>;

export type StopTimerResult =
  | { discarded: true; gameName: string }
  | ({ discarded: false } & LogSessionResult);

/** `DELETE /api/timer`: sem alvo, descarta o que estiver rodando. */
export const cancelTimerQuerySchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  clientId: z.uuid().optional(),
});

export type StartTimerResult =
  | {
      active: ActiveSession;
      /** Já estava rodando neste jogo (nada mudou). */
      alreadyRunning: boolean;
      /** Sessão encerrada ao trocar de jogo. */
      stopped: StopTimerResult | null;
      statusChangedTo: GameStatus | null;
      alreadySaved?: undefined;
    }
  | {
      /** Reenvio de um start (mesmo `clientId`) que já chegou e talvez já tenha parado. */
      alreadySaved: true;
      active: ActiveSession | null;
      alreadyRunning: true;
      stopped: null;
      statusChangedTo: null;
    };

import { z } from "zod";
import { isoDateSchema, localTimeSchema } from "./dates";
import type { GameStatus, SessionSource } from "./domain";

// Contrato das sessões de jogo, compartilhado por API, frontend e MCP.

export const MAX_MINUTES_PER_DAY = 24 * 60;

export interface PlaySessionItem {
  id: number;
  gameId: number;
  gameName: string;
  coverImageId: string | null;
  /** YYYY-MM-DD no fuso do usuário. */
  playedOn: string;
  minutes: number;
  /** Início/fim (ISO UTC) quando a sessão veio do timer; nulos em registros manuais. */
  startedAt: string | null;
  endedAt: string | null;
  note: string | null;
  source: SessionSource;
  createdAt: string;
  updatedAt: string;
}

/** Ofensiva (dias seguidos) antes e depois de uma escrita, para o cliente detectar marcos. */
export interface StreakChange {
  before: number;
  current: number;
}

export interface LogSessionResult {
  session: PlaySessionItem;
  /** Total jogado no dia da sessão (todos os jogos). */
  dayTotalMinutes: number;
  /** Total jogado nesse jogo. */
  gameTotalMinutes: number;
  /** Se registrar a sessão mudou o status do jogo (ex.: Próximos → Jogando). */
  statusChangedTo: GameStatus | null;
  /** Ofensiva antes e depois da sessão (ex.: 6 → 7). */
  streak: StreakChange;
}

const minutesSchema = z
  .number()
  .int("Use minutos inteiros")
  .min(1, "Mínimo de 1 minuto")
  .max(MAX_MINUTES_PER_DAY, "Máximo de 24h por sessão");

export const noteSchema = z.string().trim().max(500);

export const sessionIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const logSessionSchema = z.object({
  gameId: z.number().int().positive(),
  minutes: minutesSchema,
  /** Padrão: hoje. */
  playedOn: isoDateSchema.optional(),
  note: noteSchema.optional(),
});
export type LogSessionInput = z.infer<typeof logSessionSchema>;

export const updateSessionSchema = z
  .object({
    minutes: minutesSchema,
    playedOn: isoDateSchema,
    note: noteSchema.nullable(),
    /** Só para sessões de timer: horários locais (HH:MM); fim antes do início = dia seguinte. */
    startTime: localTimeSchema,
    endTime: localTimeSchema,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "Nada para atualizar");
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;

export const listSessionsQuerySchema = z.object({
  gameId: z.coerce.number().int().positive().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type ListSessionsQuery = Partial<z.output<typeof listSessionsQuerySchema>>;

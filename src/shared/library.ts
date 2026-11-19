import { z } from "zod";
import { isoDateSchema } from "./dates";
import { type GameStatus, gameStatusSchema } from "./domain";
import type { TimeToBeat } from "./igdb";

// Contrato da biblioteca, compartilhado por API, frontend e MCP.

export interface LibraryItem {
  gameId: number;
  igdbId: number;
  name: string;
  slug: string | null;
  coverImageId: string | null;
  platforms: string[];
  genres: string[];
  releaseYear: number | null;
  timeToBeat: TimeToBeat | null;
  status: GameStatus;
  platformPlayed: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  rating: number | null;
  notes: string | null;
  addedAt: string;
  updatedAt: string;
  /** Total jogado: sessões + `priorMinutes`. É o que vale para o progresso. */
  minutesPlayed: number;
  /** Tempo jogado antes de registrar no Zerômetro (sem data, fora das estatísticas). */
  priorMinutes: number;
  sessionsCount: number;
  lastPlayedOn: string | null;
  /** 0..1, estimado pelo tempo da história. null se o IGDB não tiver o tempo. */
  progress: number | null;
}

export type StatusCounts = Record<GameStatus, number>;

export interface UpdateLibraryEntryResult {
  item: LibraryItem;
  /** Status antes da mudança (ex.: para saber se o jogo acabou de ser zerado). */
  previousStatus: GameStatus;
}

export interface RemovalSummary {
  gameId: number;
  name: string;
  sessionsCount: number;
  minutesPlayed: number;
}

export const gameIdParamSchema = z.object({ gameId: z.coerce.number().int().positive() });

export const libraryListQuerySchema = z.object({
  status: gameStatusSchema.optional(),
  q: z.string().trim().max(100).optional(),
});
export type LibraryListQuery = z.infer<typeof libraryListQuerySchema>;

const platformSchema = z.string().trim().min(1).max(50);

/** Até 9999h de tempo anterior por jogo. */
export const MAX_PRIOR_MINUTES = 9999 * 60;
export const priorMinutesSchema = z
  .number()
  .int()
  .min(0, "O tempo anterior não pode ser negativo")
  .max(MAX_PRIOR_MINUTES, "O tempo anterior vai até 9999h");

export const addToLibrarySchema = z.object({
  igdbId: z.number().int().positive(),
  status: gameStatusSchema,
  platformPlayed: platformSchema.nullish(),
  priorMinutes: priorMinutesSchema.optional(),
});
export type AddToLibraryInput = z.infer<typeof addToLibrarySchema>;

export const updateLibraryEntrySchema = z
  .object({
    status: gameStatusSchema,
    rating: z.number().int().min(1).max(10).nullable(),
    notes: z.string().trim().max(2000).nullable(),
    platformPlayed: platformSchema.nullable(),
    startedAt: isoDateSchema.nullable(),
    finishedAt: isoDateSchema.nullable(),
    priorMinutes: priorMinutesSchema,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "Nada para atualizar");
export type UpdateLibraryEntryInput = z.infer<typeof updateLibraryEntrySchema>;

/** Progresso estimado (0..1) pelo tempo da história; null sem dados do IGDB. */
export function estimateProgress(minutesPlayed: number, mainSec: number | null): number | null {
  if (!mainSec) return null;
  return Math.min(1, (minutesPlayed * 60) / mainSec);
}

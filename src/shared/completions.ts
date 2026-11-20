import { z } from "zod";
import { isoDateSchema } from "./dates";
import {
  type CompletionType,
  completionTypes,
  completionTypeSchema,
  type GameStatus,
} from "./domain";
import type { TimeToBeat } from "./igdb";

// Contrato das conclusões (zerei a história, + extras, 100%), compartilhado por API, frontend e MCP.

export interface CompletionItem {
  id: number;
  gameId: number;
  type: CompletionType;
  /** YYYY-MM-DD no fuso do usuário. */
  completedOn: string;
  note: string | null;
  createdAt: string;
}

/** Resumo das conclusões de um jogo (null no item da biblioteca se nunca zerou). */
export interface CompletionSummary {
  /** A maior conclusão: 100% > história + extras > história. */
  best: CompletionType;
  count: number;
  firstCompletedOn: string;
  lastCompletedOn: string;
}

/** O que aparece para o usuário: o status, ou "pós-jogo" (jogando um jogo já zerado). */
export type DisplayState = GameStatus | "postgame";

export const displayStateLabels = { postgame: "Pós-jogo" } as const;

export function displayStateOf(status: GameStatus, completion: CompletionSummary | null) {
  return status === "playing" && completion ? "postgame" : status;
}

/** Posição de cada tipo na ordem história < + extras < 100%. */
export const completionRank = (type: CompletionType) => completionTypes.indexOf(type);

export const completionIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const markCompletedSchema = z.object({
  type: completionTypeSchema,
  /** Padrão: hoje no fuso do usuário. */
  date: isoDateSchema.optional(),
  note: z.string().trim().max(500).nullish(),
  /**
   * Também move o jogo para Zerados. Sem isso, o status não muda: um jogo "jogando" com
   * conclusão fica em pós-jogo.
   */
  moveToFinished: z.boolean().optional(),
});
export type MarkCompletedInput = z.infer<typeof markCompletedSchema>;

// ---------------------------------------------------------------------------
// Progresso estimado com alvo dinâmico

const ttbByType: Record<CompletionType, keyof TimeToBeat> = {
  main: "mainSec",
  extras: "extraSec",
  full: "completeSec",
};

export interface ProgressEstimate {
  /** 0..1; null sem tempo do IGDB e sem conclusão. */
  progress: number | null;
  /** Para onde a barra aponta: a história, os extras ou o 100%. */
  target: CompletionType;
}

/**
 * Sem conclusão, mede o tempo jogado contra a história; depois de zerar, contra o próximo nível
 * (extras e depois 100%) que tenha tempo no IGDB. Sem próximo nível com tempo, fica cheia no
 * nível já alcançado.
 */
export function estimateProgress(
  minutesPlayed: number,
  timeToBeat: TimeToBeat | null,
  best: CompletionType | null,
): ProgressEstimate {
  const next =
    best === null ? (["main"] as const) : completionTypes.slice(completionRank(best) + 1);
  for (const target of next) {
    const seconds = timeToBeat?.[ttbByType[target]];
    if (seconds) return { progress: Math.min(1, (minutesPlayed * 60) / seconds), target };
  }
  return best === null ? { progress: null, target: "main" } : { progress: 1, target: best };
}

import { z } from "zod";
import { isoDateSchema } from "./dates";
import {
  type CompletionType,
  completionTypeLabels,
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
// Progresso rumo à meta do jogo

export const ttbByType: Record<CompletionType, keyof TimeToBeat> = {
  main: "mainSec",
  extras: "extraSec",
  full: "completeSec",
};

/**
 * Até onde a barra de progresso mede: um nível de conclusão (pelo tempo do IGDB), um alvo em
 * horas escolhido pelo usuário ou nenhum (sem barra).
 */
export const progressGoals = [...completionTypes, "hours", "none"] as const;
export const progressGoalSchema = z.enum(progressGoals);
export type ProgressGoal = z.infer<typeof progressGoalSchema>;

export const progressGoalLabels: Record<ProgressGoal, string> = {
  ...completionTypeLabels,
  hours: "Horas",
  none: "Sem barra",
};

/** Teto do alvo em horas (o mesmo do tempo antes do Zerômetro). */
export const MAX_GOAL_MINUTES = 9999 * 60;
export const progressGoalMinutesSchema = z
  .number()
  .int()
  .min(60, "A meta precisa ter pelo menos 1h")
  .max(MAX_GOAL_MINUTES, "A meta pode ter até 9999h");

/** Sem meta escolhida: a história; jogo sem fim, sem barra. */
export const defaultProgressGoal = (status: GameStatus): ProgressGoal =>
  status === "endless" ? "none" : "main";

/**
 * Sem marcar a conclusão, a barra para aqui: passar do tempo do IGDB não é zerar (cada um joga
 * num ritmo).
 */
export const MAX_UNCONFIRMED_PROGRESS = 0.99;

export interface ProgressEstimate {
  /** 0..1; null sem barra (meta "none" ou sem tempo do IGDB para a meta). */
  progress: number | null;
  goal: ProgressGoal;
  /** Minutos da meta: as horas escolhidas ou o tempo do IGDB; null sem tempo. */
  targetMinutes: number | null;
  /** Meta cumprida: conclusão marcada no nível da meta (ou acima) ou as horas alcançadas. */
  done: boolean;
}

/**
 * Progresso rumo à meta. Num nível de conclusão, a barra só enche quando a conclusão é marcada
 * (mesmo zerando mais rápido que o IGDB) e, sem ela, não passa de 99%. Em horas, enche ao
 * alcançar o alvo. A meta nunca muda sozinha (zerar a história não troca a barra para os extras).
 */
export function estimateProgress({
  minutesPlayed,
  timeToBeat,
  best,
  goal,
  goalMinutes,
}: {
  minutesPlayed: number;
  timeToBeat: TimeToBeat | null;
  best: CompletionType | null;
  goal: ProgressGoal;
  goalMinutes: number | null;
}): ProgressEstimate {
  if (goal === "none") return { progress: null, goal, targetMinutes: null, done: false };
  if (goal === "hours") {
    if (!goalMinutes) return { progress: null, goal, targetMinutes: null, done: false };
    return {
      progress: Math.min(1, minutesPlayed / goalMinutes),
      goal,
      targetMinutes: goalMinutes,
      done: minutesPlayed >= goalMinutes,
    };
  }
  const seconds = timeToBeat?.[ttbByType[goal]];
  const targetMinutes = seconds ? Math.round(seconds / 60) : null;
  if (best !== null && completionRank(best) >= completionRank(goal)) {
    return { progress: 1, goal, targetMinutes, done: true };
  }
  if (!seconds) return { progress: null, goal, targetMinutes: null, done: false };
  return {
    progress: Math.min(MAX_UNCONFIRMED_PROGRESS, (minutesPlayed * 60) / seconds),
    goal,
    targetMinutes,
    done: false,
  };
}

/** Texto curto dos selos: "Zerado", "Zerado+", "100%". */
export const completionBadgeLabels: Record<CompletionType, string> = {
  main: "Zerado",
  extras: "Zerado+",
  full: "100%",
};

/** "45% da história", "60% rumo à história + extras", "80% rumo ao 100%", "50% da meta". */
export const progressTargetLabels: Record<ProgressGoal, string> = {
  main: "da história",
  extras: "rumo à história + extras",
  full: "rumo ao 100%",
  hours: "da meta",
  none: "",
};

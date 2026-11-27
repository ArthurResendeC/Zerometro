import { z } from "zod";
import {
  type CriterionId,
  criterionIds,
  criterionIdSchema,
  type CriterionWeights,
  type RatingPreset,
  ratingPresetSchema,
  SCORE_MAX,
  SCORE_MIN,
} from "./rating-criteria";

// Contrato e cálculo das avaliações, compartilhados por API, frontend (preview ao vivo) e MCP.

/** Como a nota final sai: só a ponderada, só a de coração ou a mistura das duas. */
export const ratingModes = ["weighted", "gut", "blend"] as const;
export const ratingModeSchema = z.enum(ratingModes);
export type RatingMode = z.infer<typeof ratingModeSchema>;

export const ratingModeLabels: Record<RatingMode, string> = {
  weighted: "Só a calculada",
  gut: "Só a de coração",
  blend: "Mistura das duas",
};

/** Abaixo disso de critérios aplicáveis, não há nota ponderada (a final usa a de coração). */
export const MIN_APPLICABLE_CRITERIA = 6;

/** A partir dessa diferença entre ponderada e coração, o resumo sugere revisar. */
export const DIVERGENCE_THRESHOLD = 2;

/** Peso da ponderada na mistura (o resto é a de coração): de 0,1 a 0,9. */
export const BLEND_WEIGHT = { min: 0.1, max: 0.9, step: 0.05, default: 0.7 } as const;

export const MAX_CRITERION_WEIGHT = 50;

/** Nota de um critério (1–7, inteira); null = "Não se aplica". */
export const criterionScoreSchema = z
  .number()
  .int("A nota do critério é um número inteiro")
  .min(SCORE_MIN, `A nota do critério vai de ${SCORE_MIN} a ${SCORE_MAX}`)
  .max(SCORE_MAX, `A nota do critério vai de ${SCORE_MIN} a ${SCORE_MAX}`)
  .nullable();

/** Notas por critério; critério ausente ou null = "Não se aplica". */
export const ratingScoresSchema = z.partialRecord(criterionIdSchema, criterionScoreSchema);
export type RatingScores = z.infer<typeof ratingScoresSchema>;

export const criterionWeightSchema = z
  .number()
  .min(0, "Peso não pode ser negativo")
  .max(MAX_CRITERION_WEIGHT, `Peso vai até ${MAX_CRITERION_WEIGHT}`);

/** Pesos completos (um por critério), como ficam no snapshot da avaliação e nos ajustes. */
export const ratingWeightsSchema = z.object(
  Object.fromEntries(criterionIds.map((id) => [id, criterionWeightSchema])) as Record<
    CriterionId,
    typeof criterionWeightSchema
  >,
);

/** Nota de coração: 0 a 10 em passos de 0,5. */
export const enjoymentSchema = z
  .number()
  .min(0, "A nota de coração vai de 0 a 10")
  .max(10, "A nota de coração vai de 0 a 10")
  .refine((n) => Number.isInteger(n * 2), "A nota de coração vai em passos de 0,5");

export const criterionNotesSchema = z.partialRecord(
  criterionIdSchema,
  z.string().trim().max(500, "Comentário do critério até 500 caracteres"),
);
export type CriterionNotes = z.infer<typeof criterionNotesSchema>;

export const ratingReviewSchema = z.string().trim().max(5000, "Review até 5000 caracteres");

export const ratingInputSchema = z.object({
  scores: ratingScoresSchema.default({}),
  enjoyment: enjoymentSchema,
  /** Sem pesos, valem os do preset (sobre os padrão do usuário). */
  weights: ratingWeightsSchema.optional(),
  preset: ratingPresetSchema.default("default"),
  /** Sem modo, vale o dos ajustes. */
  mode: ratingModeSchema.optional(),
  criterionNotes: criterionNotesSchema.nullish(),
  review: ratingReviewSchema.nullish(),
  /** Playthrough avaliado (uma conclusão do jogo). */
  completionId: z.number().int().positive().nullish(),
});
export type RatingInput = z.input<typeof ratingInputSchema>;
export type ParsedRatingInput = z.output<typeof ratingInputSchema>;

export const updateRatingSchema = z
  .object({
    scores: ratingScoresSchema,
    enjoyment: enjoymentSchema,
    weights: ratingWeightsSchema,
    preset: ratingPresetSchema,
    mode: ratingModeSchema,
    criterionNotes: criterionNotesSchema.nullable(),
    review: ratingReviewSchema.nullable(),
    completionId: z.number().int().positive().nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "Nada para atualizar");
export type UpdateRatingInput = z.infer<typeof updateRatingSchema>;

export const ratingIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const ratingTemplateQuerySchema = z.object({
  gameId: z.coerce.number().int().positive().optional(),
});

// ---------------------------------------------------------------------------
// Cálculo

/** 1–7 → 0–10. */
export const toTenScale = (score: number) => ((score - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * 10;

export interface ComputeRatingInput {
  scores: RatingScores;
  weights: CriterionWeights;
  enjoyment: number;
  mode: RatingMode;
  /** Peso da ponderada no modo "blend". */
  blendWeight: number;
}

export interface ComputedRating {
  /** 0–10, sem arredondar; null com menos de `MIN_APPLICABLE_CRITERIA` critérios. */
  weighted: number | null;
  gut: number;
  final: number;
  /** O modo que de fato gerou a final ("gut" quando não há ponderada). */
  effectiveMode: RatingMode;
  applicableCount: number;
  /** Ponderada e coração muito diferentes (≥ `DIVERGENCE_THRESHOLD`). */
  divergent: boolean;
}

/** Critérios com nota (os "Não se aplica" saem do cálculo e os pesos se renormalizam). */
export function applicableCriteria(scores: RatingScores): CriterionId[] {
  return criterionIds.filter((id) => typeof scores[id] === "number");
}

/** Aplica a fórmula da avaliação. Pura: roda igual no preview do client e no servidor. */
export function computeRating({
  scores,
  weights,
  enjoyment,
  mode,
  blendWeight,
}: ComputeRatingInput): ComputedRating {
  const applicable = applicableCriteria(scores);
  let weighted: number | null = null;
  if (applicable.length >= MIN_APPLICABLE_CRITERIA) {
    const totalWeight = applicable.reduce((sum, id) => sum + weights[id], 0);
    if (totalWeight > 0) {
      weighted =
        applicable.reduce((sum, id) => sum + weights[id] * toTenScale(scores[id]!), 0) /
        totalWeight;
    }
  }

  const effectiveMode: RatingMode = weighted === null ? "gut" : mode;
  const final =
    weighted === null || effectiveMode === "gut"
      ? enjoyment
      : effectiveMode === "weighted"
        ? weighted
        : blendWeight * weighted + (1 - blendWeight) * enjoyment;

  return {
    weighted,
    gut: enjoyment,
    final,
    effectiveMode,
    applicableCount: applicable.length,
    divergent: weighted !== null && Math.abs(weighted - enjoyment) >= DIVERGENCE_THRESHOLD,
  };
}

/** Nota para exibir: 1 casa decimal, vírgula ("8,5"). */
export function formatScore(score: number): string {
  return (Math.round(score * 10) / 10).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export const DIVERGENCE_MESSAGE =
  "Sua nota de coração ficou bem diferente da calculada. Quer revisar algum critério ou usar a de coração?";

// ---------------------------------------------------------------------------
// Respostas da API

export interface RatingItem {
  id: number;
  gameId: number;
  completionId: number | null;
  scores: RatingScores;
  criterionNotes: CriterionNotes | null;
  /** Snapshot dos pesos usados (a nota não muda se os pesos padrão mudarem depois). */
  weights: CriterionWeights;
  preset: RatingPreset;
  enjoyment: number;
  weighted: number | null;
  final: number;
  mode: RatingMode;
  review: string | null;
  divergent: boolean;
  applicableCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Uma nota dada antes no mesmo critério, para calibrar ("Expedition 33: 6"). */
export interface CalibrationEntry {
  gameId: number;
  igdbId: number;
  name: string;
  score: number;
}

export interface RatingTemplate {
  /** Pesos base (os padrão do método ou os personalizados do usuário). */
  baseWeights: CriterionWeights;
  customWeights: boolean;
  /** Preset sugerido pelos gêneros do jogo (default sem jogo). */
  suggestedPreset: Exclude<RatingPreset, "custom">;
  mode: RatingMode;
  blendWeight: number;
  /** Últimas notas por critério em outros jogos (as mais recentes primeiro). */
  calibration: Record<CriterionId, CalibrationEntry[]>;
  /** Última avaliação do jogo (para reavaliar a partir dela). */
  latest: RatingItem | null;
}

/** Média de um critério na biblioteca, com os extremos (Perfil de gamer). */
export interface CriterionAverage {
  criterion: CriterionId;
  /** 1–7. */
  average: number;
  count: number;
  /** Soma dos pesos usados, normalizada: o quanto o usuário valoriza o critério. */
  averageWeight: number;
  best: CalibrationEntry | null;
  worst: CalibrationEntry | null;
}

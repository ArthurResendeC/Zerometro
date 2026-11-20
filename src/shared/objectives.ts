import { z } from "zod";
import type { ObjectiveSource } from "./domain";

// Contrato dos objetivos de um jogo (checkbox ou contador), compartilhado por API, frontend e MCP.

export const MAX_OBJECTIVES_PER_GAME = 200;
export const MAX_OBJECTIVE_TARGET = 100_000;

export interface ObjectiveItem {
  id: number;
  gameId: number;
  /** "manual" hoje; conquistas da Steam/RA no futuro (essas não são editáveis). */
  source: ObjectiveSource;
  title: string;
  description: string | null;
  iconUrl: string | null;
  rarity: number | null;
  /** 1 = checkbox; mais que 1 = contador (ex.: 900 sementes Korok). */
  target: number;
  /** 0..target. */
  progress: number;
  /** Quando chegou ao alvo (ISO UTC); null enquanto não chega. */
  unlockedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ObjectivesSummary {
  total: number;
  unlocked: number;
}

/** Resposta das escritas: o objetivo, o resumo do jogo e o que a interface deve comemorar. */
export interface ObjectiveWriteResult {
  objective: ObjectiveItem;
  summary: ObjectivesSummary;
  /** Esta mudança concluiu o último objetivo do jogo. */
  allDoneNow: boolean;
  /** Acabou de concluir todos e o jogo ainda não tem conclusão 100%: perguntar se quer marcar. */
  suggestFullCompletion: boolean;
}

export const objectiveIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

const titleSchema = z
  .string()
  .trim()
  .min(1, "Dê um nome ao objetivo")
  .max(120, "O nome vai até 120 caracteres");
const descriptionSchema = z.string().trim().max(500, "A descrição vai até 500 caracteres");
const targetSchema = z
  .number()
  .int()
  .min(1, "O alvo é pelo menos 1")
  .max(MAX_OBJECTIVE_TARGET, "O alvo vai até 100.000");

export const addObjectiveSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.nullish(),
  target: targetSchema.optional(),
});
export type AddObjectiveInput = z.infer<typeof addObjectiveSchema>;

/** Progresso fora de 0..alvo é ajustado para o limite (não dá erro). */
export const updateObjectiveSchema = z
  .object({
    title: titleSchema,
    description: descriptionSchema.nullable(),
    target: targetSchema,
    progress: z.number().int(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "Nada para atualizar");
export type UpdateObjectiveInput = z.infer<typeof updateObjectiveSchema>;

export const incrementObjectiveSchema = z.object({
  /** Negativo desfaz (ex.: -1). */
  by: z
    .number()
    .int()
    .min(-MAX_OBJECTIVE_TARGET)
    .max(MAX_OBJECTIVE_TARGET)
    .refine((by) => by !== 0, "Informe quanto somar")
    .default(1),
});

export const reorderObjectivesSchema = z.object({
  ids: z.array(z.number().int().positive()).max(MAX_OBJECTIVES_PER_GAME),
});

export const objectiveDone = (o: Pick<ObjectiveItem, "progress" | "target">) =>
  o.progress >= o.target;

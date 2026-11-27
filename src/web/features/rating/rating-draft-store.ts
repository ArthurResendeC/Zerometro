import { z } from "zod";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { criterionIdSchema, ratingPresetSchema } from "@shared/rating-criteria";
import {
  criterionNotesSchema,
  enjoymentSchema,
  ratingModeSchema,
  ratingWeightsSchema,
} from "@shared/ratings";

// Rascunho da avaliação em andamento, por jogo, guardado neste aparelho: fechar a aba no meio
// não perde o que já foi respondido. Estado de UI; some ao salvar ou ao recomeçar.

export const ratingDraftSchema = z.object({
  step: z.number().int().min(0),
  preset: ratingPresetSchema,
  completionId: z.number().int().positive().nullable(),
  /** Notas 1–7 já dadas (o que falta não está aqui). */
  scores: z.partialRecord(criterionIdSchema, z.number().int().min(1).max(7)),
  notApplicable: z.array(criterionIdSchema),
  criterionNotes: criterionNotesSchema,
  enjoyment: enjoymentSchema,
  weights: ratingWeightsSchema,
  mode: ratingModeSchema,
  review: z.string(),
  /** "Só quero dar uma nota": pula os critérios. */
  quick: z.boolean(),
});
export type RatingDraft = z.infer<typeof ratingDraftSchema>;

interface RatingDraftState {
  drafts: Record<number, RatingDraft>;
  save: (gameId: number, draft: RatingDraft) => void;
  discard: (gameId: number) => void;
}

const storedSchema = z.object({
  drafts: z.record(z.coerce.number(), ratingDraftSchema.nullable().catch(null)).catch({}),
});

export const useRatingDrafts = create<RatingDraftState>()(
  persist(
    (set) => ({
      drafts: {},
      save: (gameId, draft) => set((s) => ({ drafts: { ...s.drafts, [gameId]: draft } })),
      discard: (gameId) =>
        set((s) => {
          const { [gameId]: _, ...rest } = s.drafts;
          return { drafts: rest };
        }),
    }),
    {
      name: "zerometro:rating-drafts",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ drafts }) => ({ drafts }),
      // Rascunho de uma versão antiga (ou corrompido) é descartado em vez de quebrar o formulário.
      merge: (persisted, current) => {
        const parsed = storedSchema.safeParse(persisted ?? {});
        const drafts = parsed.success
          ? Object.fromEntries(
              Object.entries(parsed.data.drafts).filter(([, draft]) => draft !== null),
            )
          : {};
        return { ...current, drafts: drafts as Record<number, RatingDraft> };
      },
    },
  ),
);

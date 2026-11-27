import type { CompletionItem } from "@shared/completions";
import { presetNotApplicable, presetWeights, ratingCriteria } from "@shared/rating-criteria";
import type { RatingInput, RatingScores, RatingTemplate } from "@shared/ratings";
import type { RatingDraft } from "./rating-draft-store";

// Regras puras do rascunho da avaliação (passos, valores iniciais e o que vai para a API).

/** Passos: 0 = introdução, 1..13 = critérios, depois coração e resumo. */
export const INTRO_STEP = 0;
export const ENJOYMENT_STEP = ratingCriteria.length + 1;
export const SUMMARY_STEP = ENJOYMENT_STEP + 1;

export function initialDraft(template: RatingTemplate, completions: CompletionItem[]): RatingDraft {
  const preset = template.suggestedPreset;
  return {
    step: INTRO_STEP,
    preset,
    completionId: completions[0]?.id ?? null,
    scores: {},
    notApplicable: presetNotApplicable(preset),
    criterionNotes: {},
    enjoyment: 7,
    weights: presetWeights(preset, template.baseWeights),
    mode: template.mode,
    review: "",
    quick: false,
  };
}

/** Notas para a API: as dadas, e null nos "Não se aplica". */
export function draftScores(draft: RatingDraft): RatingScores {
  if (draft.quick) return {};
  const scores: RatingScores = {};
  for (const c of ratingCriteria) {
    if (draft.notApplicable.includes(c.id)) scores[c.id] = null;
    else if (draft.scores[c.id] !== undefined) scores[c.id] = draft.scores[c.id];
  }
  return scores;
}

export function draftToInput(draft: RatingDraft): RatingInput {
  const notes = Object.fromEntries(
    Object.entries(draft.criterionNotes).filter(([, text]) => text?.trim()),
  );
  return {
    scores: draftScores(draft),
    enjoyment: draft.enjoyment,
    weights: draft.weights,
    preset: draft.preset,
    mode: draft.quick ? "gut" : draft.mode,
    criterionNotes: Object.keys(notes).length > 0 ? notes : null,
    review: draft.review.trim() || null,
    completionId: draft.completionId,
  };
}

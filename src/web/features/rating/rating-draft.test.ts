import { describe, expect, test } from "bun:test";
import { DEFAULT_WEIGHTS, presetWeights } from "@shared/rating-criteria";
import type { RatingTemplate } from "@shared/ratings";
import { draftScores, draftToInput, initialDraft } from "./rating-draft";

const template = {
  baseWeights: DEFAULT_WEIGHTS,
  customWeights: false,
  suggestedPreset: "racing_sports",
  mode: "blend",
  blendWeight: 0.7,
  calibration: {},
  latest: null,
} as unknown as RatingTemplate;

const completion = {
  id: 4,
  gameId: 1,
  type: "main" as const,
  completedOn: "2026-11-01",
  note: null,
  createdAt: "2026-11-01T00:00:00Z",
};

describe("rascunho da avaliação", () => {
  test("começa no preset sugerido, com o 'Não se aplica' dele e o playthrough mais recente", () => {
    const draft = initialDraft(template, [completion]);
    expect(draft).toMatchObject({ preset: "racing_sports", completionId: 4, mode: "blend" });
    expect(draft.notApplicable.toSorted()).toEqual(["narrative", "social"]);
    expect(draft.weights).toEqual(presetWeights("racing_sports"));
    expect(initialDraft(template, []).completionId).toBeNull();
  });

  test("notas para a API: as dadas, null no 'Não se aplica', nada nas sem resposta", () => {
    const draft = { ...initialDraft(template, []), scores: { controls: 6, narrative: 5 } };
    // narrative tem nota mas está em "Não se aplica": vale o "Não se aplica".
    expect(draftScores(draft)).toEqual({ controls: 6, narrative: null, social: null });
  });

  test("nota rápida: sem critérios e só a de coração; comentários e review vazios somem", () => {
    const draft = {
      ...initialDraft(template, []),
      scores: { controls: 6 },
      criterionNotes: { controls: "  ", goals: "Mapa confuso" },
      review: "   ",
    };
    expect(draftToInput(draft)).toMatchObject({
      criterionNotes: { goals: "Mapa confuso" },
      review: null,
      mode: "blend",
    });
    expect(draftToInput({ ...draft, quick: true })).toMatchObject({ scores: {}, mode: "gut" });
  });
});

import { describe, expect, test } from "bun:test";
import {
  criterionIds,
  DEFAULT_WEIGHTS,
  presetNotApplicable,
  presetWeights,
  suggestPreset,
} from "./rating-criteria";
import {
  computeRating,
  type ComputeRatingInput,
  enjoymentSchema,
  formatScore,
  ratingInputSchema,
  type RatingScores,
  toTenScale,
} from "./ratings";

/** Todos os critérios (menos o social) com a mesma nota. */
const allScores = (score: number): RatingScores =>
  Object.fromEntries(criterionIds.filter((id) => id !== "social").map((id) => [id, score]));

const compute = (fields: Partial<ComputeRatingInput> = {}) =>
  computeRating({
    scores: allScores(7),
    weights: DEFAULT_WEIGHTS,
    enjoyment: 8,
    mode: "blend",
    blendWeight: 0.7,
    ...fields,
  });

const game = (genres: string[], gameModes: string[] = []) => ({ genres, gameModes });
const parse = (scores: unknown) => ratingInputSchema.safeParse({ scores, enjoyment: 8 }).success;

describe("pesos e presets", () => {
  test("pesos padrão somam 100 sem o social", () => {
    const total = criterionIds
      .filter((id) => id !== "social")
      .reduce((sum, id) => sum + DEFAULT_WEIGHTS[id], 0);
    expect(total).toBe(100);
  });

  test("presets multiplicam os pesos base", () => {
    const rpg = presetWeights("rpg");
    expect(rpg.narrative).toBe(18);
    expect(rpg.meaning).toBe(13);
    expect(rpg.immersion).toBe(14.4);
    expect(rpg.controls).toBe(8);
    expect(presetWeights("platformer").narrative).toBe(6);
    // Sobre pesos personalizados do usuário.
    expect(presetWeights("platformer", { ...DEFAULT_WEIGHTS, controls: 10 }).controls).toBe(15);
    expect(presetWeights("default")).toEqual(DEFAULT_WEIGHTS);
  });

  test("social começa fora, menos no multiplayer; corrida tira a narrativa", () => {
    expect(presetNotApplicable("default")).toEqual(["social"]);
    expect(presetNotApplicable("multiplayer")).toEqual([]);
    expect(presetNotApplicable("racing_sports").toSorted()).toEqual(["narrative", "social"]);
  });

  test("sugere o preset pelos gêneros e modos do IGDB", () => {
    expect(suggestPreset(game(["Role-playing (RPG)", "Adventure"]))).toBe("rpg");
    expect(suggestPreset(game(["Platform", "Indie"]))).toBe("platformer");
    expect(suggestPreset(game(["Role-playing (RPG)", "Hack and slash/Beat 'em up"]))).toBe("rpg");
    expect(suggestPreset(game(["Racing"]))).toBe("racing_sports");
    expect(suggestPreset(game(["Shooter"], ["Battle Royale"]))).toBe("multiplayer");
    expect(suggestPreset(game(["MOBA"]))).toBe("multiplayer");
    expect(suggestPreset({ ...game(["Shooter"]), status: "endless" })).toBe("multiplayer");
    expect(suggestPreset(game(["Puzzle"]))).toBe("default");
  });
});

describe("computeRating", () => {
  test("converte 1–7 para 0–10", () => {
    expect(toTenScale(1)).toBe(0);
    expect(toTenScale(4)).toBe(5);
    expect(toTenScale(7)).toBe(10);
    expect(compute({ scores: allScores(4), mode: "weighted" }).weighted).toBe(5);
  });

  test("média ponderada pelos pesos", () => {
    // Controles (8) em 7 = 10; o resto em 1 = 0 → 8 / 100 × 10 = 0,8.
    const scores = { ...allScores(1), controls: 7 };
    expect(compute({ scores, mode: "weighted" }).weighted).toBeCloseTo(0.8);
  });

  test("'Não se aplica' tira o critério e renormaliza os pesos", () => {
    const scores = { ...allScores(4), narrative: null, technical: null, controls: 7 };
    // Peso aplicável: 100 − 12 − 6 = 82; controles 8 × 10 + 74 × 5 = 450 → 450 / 82.
    expect(compute({ scores, mode: "weighted" }).weighted).toBeCloseTo(450 / 82);
    expect(compute({ scores }).applicableCount).toBe(10);
  });

  test("modos: ponderada, coração e mistura", () => {
    expect(compute({ mode: "weighted" }).final).toBe(10);
    expect(compute({ mode: "gut" }).final).toBe(8);
    expect(compute({ mode: "blend" }).final).toBeCloseTo(0.7 * 10 + 0.3 * 8);
    expect(compute({ mode: "blend", blendWeight: 0.5 }).final).toBe(9);
  });

  test("menos de 6 critérios: sem ponderada, a final é a de coração", () => {
    const scores = { controls: 7, goals: 7, feedback: 7, challenge: 7, audiovisual: 7 };
    const result = compute({ scores, mode: "weighted" });
    expect(result).toMatchObject({ weighted: null, final: 8, effectiveMode: "gut" });
    expect(result.divergent).toBe(false);
    expect(compute({ scores: { ...scores, technical: 7 } }).weighted).toBe(10);
  });

  test("pesos todos zerados: sem ponderada", () => {
    const weights = Object.fromEntries(criterionIds.map((id) => [id, 0])) as typeof DEFAULT_WEIGHTS;
    expect(compute({ weights }).weighted).toBeNull();
  });

  test("aviso de divergência a partir de 2 pontos", () => {
    expect(compute({ enjoyment: 8 }).divergent).toBe(true); // 10 × 8
    expect(compute({ enjoyment: 8.5 }).divergent).toBe(false);
    expect(compute({ scores: allScores(1), enjoyment: 2 }).divergent).toBe(true);
  });
});

describe("validação", () => {
  test("notas dos critérios de 1 a 7, inteiras", () => {
    expect(parse({ controls: 7, narrative: null })).toBe(true);
    expect(parse({ controls: 0 })).toBe(false);
    expect(parse({ controls: 8 })).toBe(false);
    expect(parse({ controls: 4.5 })).toBe(false);
    expect(parse({ unknown: 4 })).toBe(false);
  });

  test("nota de coração de 0 a 10 em passos de 0,5", () => {
    expect(enjoymentSchema.safeParse(7.5).success).toBe(true);
    expect(enjoymentSchema.safeParse(0).success).toBe(true);
    expect(enjoymentSchema.safeParse(7.3).success).toBe(false);
    expect(enjoymentSchema.safeParse(10.5).success).toBe(false);
    expect(enjoymentSchema.safeParse(-1).success).toBe(false);
  });

  test("pesos não negativos", () => {
    const weights = { ...DEFAULT_WEIGHTS, controls: -1 };
    expect(ratingInputSchema.safeParse({ enjoyment: 8, weights }).success).toBe(false);
  });
});

test("formatScore: 1 casa decimal com vírgula", () => {
  expect(formatScore(8.46)).toBe("8,5");
  expect(formatScore(10)).toBe("10,0");
});

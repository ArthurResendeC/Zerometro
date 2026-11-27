import { beforeEach, describe, expect, test } from "bun:test";
import { criterionIds, DEFAULT_WEIGHTS, presetWeights } from "../../shared/rating-criteria";
import { type RatingInput, ratingInputSchema, type RatingScores } from "../../shared/ratings";
import { activityLog, libraryEntries } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { createFakeIgdb, createTestContext, fakeIgdbGame } from "../testing";
import { markCompleted } from "./completions";
import type { ServiceContext } from "./context";
import { addToLibrary, getLibraryItem, previewRemoval, removeFromLibrary } from "./library";
import {
  createRating,
  deleteRating,
  getCalibration,
  getCriteriaAverages,
  getLatestRating,
  getRatingTemplate,
  listRatings,
  updateRating,
} from "./ratings";
import { updateSettings } from "./settings";

const igdb = createFakeIgdb([
  fakeIgdbGame(), // Persona 5 Royal, RPG
  fakeIgdbGame({ igdbId: 1, name: "Celeste", genres: ["Platform", "Indie"] }),
  fakeIgdbGame({ igdbId: 2, name: "Forza Horizon", genres: ["Racing"] }),
]);

let ctx: ServiceContext;

beforeEach(() => {
  ctx = createTestContext();
});

async function add(igdbId = 114283) {
  return (await addToLibrary(ctx, igdb, { igdbId, status: "playing" })).gameId;
}

/** Todos os critérios (menos o social) com a mesma nota. */
const allScores = (score: number): RatingScores =>
  Object.fromEntries(criterionIds.filter((id) => id !== "social").map((id) => [id, score]));

const rate = (gameId: number, input: Partial<RatingInput> = {}, at?: string) =>
  createRating(
    at ? { ...ctx, now: new Date(at) } : ctx,
    gameId,
    ratingInputSchema.parse({ scores: allScores(7), enjoyment: 8, ...input }),
  );

describe("createRating", () => {
  test("calcula, guarda o snapshot dos pesos e atualiza o cache da biblioteca", async () => {
    const gameId = await add();

    const { rating, item } = rate(gameId);

    expect(rating).toMatchObject({
      gameId,
      weighted: 10,
      enjoyment: 8,
      mode: "blend",
      preset: "default",
      weights: DEFAULT_WEIGHTS,
      divergent: true,
      applicableCount: 12,
    });
    expect(rating.final).toBeCloseTo(0.7 * 10 + 0.3 * 8);
    expect(item.rating).toBeCloseTo(9.4);
    const log = ctx.db.select().from(activityLog).all().at(-1);
    expect(log).toMatchObject({ action: "rating.add" });
  });

  test("os pesos vêm do preset (sobre os personalizados dos ajustes)", async () => {
    const gameId = await add();
    expect(rate(gameId, { preset: "rpg" }).rating.weights).toEqual(presetWeights("rpg"));

    const custom = { ...DEFAULT_WEIGHTS, controls: 20 };
    updateSettings(ctx, { ratingCustomWeights: custom });
    expect(rate(gameId, { preset: "platformer" }).rating.weights.controls).toBe(30);
    expect(rate(gameId).rating.weights).toEqual(custom);
  });

  test("modo dos ajustes quando não vem no input", async () => {
    const gameId = await add();
    updateSettings(ctx, { ratingMode: "weighted" });
    expect(rate(gameId).rating).toMatchObject({ mode: "weighted", final: 10 });
    updateSettings(ctx, { ratingMode: "blend", ratingBlendWeight: 0.5 });
    expect(rate(gameId).rating.final).toBe(9);
  });

  test("nota rápida: só a de coração", async () => {
    const gameId = await add();
    const { rating, item } = rate(gameId, { scores: {}, enjoyment: 7.5, mode: "gut" });
    expect(rating).toMatchObject({ weighted: null, final: 7.5, applicableCount: 0 });
    expect(item.rating).toBe(7.5);
  });

  test("playthrough: a conclusão tem de ser do jogo", async () => {
    const gameId = await add();
    const other = await add(1);
    const { completion } = markCompleted(ctx, gameId, { type: "main" });
    expect(rate(gameId, { completionId: completion.id }).rating.completionId).toBe(completion.id);
    expect(() => rate(other, { completionId: completion.id })).toThrow(ValidationError);
  });

  test("jogo fora da biblioteca: 404", () => {
    expect(() => rate(999)).toThrow(NotFoundError);
  });

  test("comentários vazios dos critérios não são guardados", async () => {
    const gameId = await add();
    const { rating } = rate(gameId, { criterionNotes: { controls: "", narrative: "Que final!" } });
    expect(rating.criterionNotes).toEqual({ narrative: "Que final!" });
    expect(rate(gameId, { criterionNotes: { controls: "" } }).rating.criterionNotes).toBeNull();
  });
});

describe("várias avaliações", () => {
  test("a mais recente é a atual e manda no cache; apagar volta para a anterior", async () => {
    const gameId = await add();
    const first = rate(gameId, { enjoyment: 6, mode: "gut" }, "2026-10-01T12:00:00Z").rating;
    const second = rate(gameId, { enjoyment: 9, mode: "gut" }, "2026-11-01T12:00:00Z").rating;

    expect(listRatings(ctx, gameId).map((r) => r.id)).toEqual([second.id, first.id]);
    expect(getLatestRating(ctx, gameId)?.id).toBe(second.id);
    expect(getLibraryItem(ctx, gameId).rating).toBe(9);

    expect(deleteRating(ctx, second.id).item.rating).toBe(6);
    expect(deleteRating(ctx, first.id).item.rating).toBeNull();
    expect(() => deleteRating(ctx, first.id)).toThrow(NotFoundError);
  });

  test("snapshot: mudar os pesos padrão depois não muda avaliações antigas", async () => {
    const gameId = await add();
    const scores = { ...allScores(1), controls: 7 };
    const before = rate(gameId, { scores, mode: "weighted" }).rating;
    updateSettings(ctx, { ratingCustomWeights: { ...DEFAULT_WEIGHTS, controls: 50 } });

    expect(getLatestRating(ctx, gameId)).toMatchObject({
      weighted: before.weighted,
      weights: DEFAULT_WEIGHTS,
    });
    // Editar outra coisa recalcula com o snapshot, não com os pesos novos.
    expect(updateRating(ctx, before.id, { review: "Bom" }).rating.weighted).toBeCloseTo(0.8);
  });
});

describe("updateRating", () => {
  test("recalcula e atualiza o cache", async () => {
    const gameId = await add();
    const { rating } = rate(gameId, { mode: "weighted" });
    const { rating: updated, item } = updateRating(ctx, rating.id, { scores: allScores(4) });
    expect(updated.weighted).toBe(5);
    expect(updated.final).toBe(5);
    expect(item.rating).toBe(5);
  });

  test("trocar o preset sem pesos usa os pesos do preset novo", async () => {
    const gameId = await add();
    const { rating } = rate(gameId);
    expect(updateRating(ctx, rating.id, { preset: "rpg" }).rating.weights).toEqual(
      presetWeights("rpg"),
    );
  });
});

describe("remover o jogo da biblioteca", () => {
  test("leva as avaliações junto", async () => {
    const gameId = await add();
    rate(gameId);
    expect(previewRemoval(ctx, gameId).ratingsCount).toBe(1);
    removeFromLibrary(ctx, gameId);
    await add();
    expect(listRatings(ctx, gameId)).toEqual([]);
    expect(ctx.db.select({ rating: libraryEntries.rating }).from(libraryEntries).get()).toEqual({
      rating: null,
    });
  });
});

describe("calibragem, médias e template", () => {
  test("calibragem: notas recentes no mesmo critério, sem o jogo avaliado", async () => {
    const persona = await add();
    const celeste = await add(1);
    const forza = await add(2);
    rate(persona, { scores: { ...allScores(6), narrative: 7 } }, "2026-10-01T12:00:00Z");
    rate(celeste, { scores: { ...allScores(5), narrative: 3 } }, "2026-10-10T12:00:00Z");
    rate(forza, { scores: { ...allScores(4), narrative: null } }, "2026-10-20T12:00:00Z");
    // Reavaliar o Persona: só a avaliação atual conta.
    rate(persona, { scores: { ...allScores(6), narrative: 5 } }, "2026-10-25T12:00:00Z");

    const calibration = getCalibration(ctx, { excludeGameId: forza });
    expect(calibration.narrative).toEqual([
      expect.objectContaining({ name: "Persona 5 Royal", score: 5 }),
      expect.objectContaining({ name: "Celeste", score: 3 }),
    ]);
    // A reavaliação do Persona (25/10) é a mais recente.
    expect(getCalibration(ctx, { limit: 1 }).controls.map((e) => e.name)).toEqual([
      "Persona 5 Royal",
    ]);
    expect(getCalibration(ctx).social).toEqual([]);
    // Uma nota rápida depois não tira os critérios da avaliação anterior.
    rate(celeste, { scores: {}, mode: "gut" }, "2026-10-30T12:00:00Z");
    expect(getCalibration(ctx).narrative.map((e) => e.name)).toEqual([
      "Persona 5 Royal",
      "Celeste",
    ]);
  });

  test("médias por critério com o maior e o menor", async () => {
    const persona = await add();
    const celeste = await add(1);
    rate(persona, { scores: { ...allScores(6), narrative: 7 } });
    rate(celeste, { scores: { ...allScores(4), narrative: 4 } });

    const averages = getCriteriaAverages(ctx);
    const narrative = averages.find((a) => a.criterion === "narrative");
    expect(narrative).toMatchObject({ average: 5.5, count: 2 });
    expect(narrative?.best?.name).toBe("Persona 5 Royal");
    expect(narrative?.worst?.name).toBe("Celeste");
    expect(averages.find((a) => a.criterion === "social")).toBeUndefined();
    expect(averages[0]?.criterion).toBe("narrative"); // a maior média primeiro
  });

  test("template: preset sugerido pelos gêneros, ajustes e última avaliação", async () => {
    const persona = await add();
    const celeste = await add(1);
    expect(getRatingTemplate(ctx, persona)).toMatchObject({
      suggestedPreset: "rpg",
      mode: "blend",
      blendWeight: 0.7,
      customWeights: false,
      latest: null,
    });
    const { rating } = rate(celeste);
    expect(getRatingTemplate(ctx, celeste)).toMatchObject({
      suggestedPreset: "platformer",
      latest: { id: rating.id },
    });
    expect(getRatingTemplate(ctx).suggestedPreset).toBe("default");
  });
});

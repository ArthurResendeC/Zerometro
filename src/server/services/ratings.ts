import { and, desc, eq } from "drizzle-orm";
import type { LibraryItem } from "../../shared/library";
import {
  criterionIds,
  type CriterionId,
  type CriterionWeights,
  DEFAULT_WEIGHTS,
  presetWeights,
  type RatingPreset,
  suggestPreset,
} from "../../shared/rating-criteria";
import {
  applicableCriteria,
  type CalibrationEntry,
  computeRating,
  type CriterionAverage,
  DIVERGENCE_THRESHOLD,
  type ParsedRatingInput,
  type RatingItem,
  type RatingTemplate,
  type UpdateRatingInput,
} from "../../shared/ratings";
import type { Settings } from "../../shared/settings";
import type { DbOrTx } from "../db/client";
import { completions, games, libraryEntries, type Rating, ratings } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { logActivity } from "./activity";
import type { ServiceContext, UserScope } from "./context";
import { getLibraryItem } from "./library";
import { getSettings } from "./settings";

// Avaliações guiadas: notas por critério, nota de coração e a final (média ponderada, coração ou
// mistura). A final da mais recente fica em cache em `library_entries.rating`.

/** Quantos jogos a calibragem mostra por critério. */
export const CALIBRATION_LIMIT = 3;

function toItem(row: Rating): RatingItem {
  return {
    id: row.id,
    gameId: row.gameId,
    completionId: row.completionId,
    scores: row.scores,
    criterionNotes: row.criterionNotes,
    weights: { ...DEFAULT_WEIGHTS, ...row.weights },
    preset: row.preset,
    enjoyment: row.enjoyment,
    weighted: row.weighted,
    final: row.final,
    mode: row.mode,
    review: row.review,
    divergent:
      row.weighted !== null && Math.abs(row.weighted - row.enjoyment) >= DIVERGENCE_THRESHOLD,
    applicableCount: applicableCriteria(row.scores).length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const ofGame = (userId: string, gameId: number) =>
  and(eq(ratings.userId, userId), eq(ratings.gameId, gameId));

/** Avaliações do jogo, da mais recente para a mais antiga. */
export function listRatings(scope: UserScope, gameId: number): RatingItem[] {
  getLibraryItem(scope, gameId); // 404 se o jogo não estiver na biblioteca
  return scope.db
    .select()
    .from(ratings)
    .where(ofGame(scope.userId, gameId))
    .orderBy(desc(ratings.createdAt), desc(ratings.id))
    .all()
    .map(toItem);
}

/** A avaliação atual do jogo (a mais recente), ou null. */
export function getLatestRating({ db, userId }: UserScope, gameId: number): RatingItem | null {
  const row = db
    .select()
    .from(ratings)
    .where(ofGame(userId, gameId))
    .orderBy(desc(ratings.createdAt), desc(ratings.id))
    .get();
  return row ? toItem(row) : null;
}

export function getRating({ db, userId }: UserScope, id: number): RatingItem {
  const row = db
    .select()
    .from(ratings)
    .where(and(eq(ratings.id, id), eq(ratings.userId, userId)))
    .get();
  if (!row) throw new NotFoundError(`Avaliação ${id} não encontrada`);
  return toItem(row);
}

/** Pesos base do usuário: os personalizados dos ajustes ou os do método. */
export function baseWeights(settings: Settings): CriterionWeights {
  return settings.ratingCustomWeights ?? DEFAULT_WEIGHTS;
}

/** Pesos de uma avaliação: os informados (personalizado) ou os do preset. */
function resolveWeights(
  settings: Settings,
  preset: RatingPreset,
  weights: CriterionWeights | undefined,
): CriterionWeights {
  return weights ?? presetWeights(preset, baseWeights(settings));
}

function assertCompletion(db: DbOrTx, userId: string, gameId: number, completionId: number) {
  const row = db
    .select({ gameId: completions.gameId })
    .from(completions)
    .where(and(eq(completions.id, completionId), eq(completions.userId, userId)))
    .get();
  if (!row || row.gameId !== gameId)
    throw new ValidationError(`Conclusão ${completionId} não é deste jogo`);
}

/** Copia a final da avaliação mais recente para `library_entries.rating` (null sem avaliação). */
function refreshRatingCache(db: DbOrTx, userId: string, gameId: number) {
  const latest = db
    .select({ final: ratings.final })
    .from(ratings)
    .where(ofGame(userId, gameId))
    .orderBy(desc(ratings.createdAt), desc(ratings.id))
    .get();
  db.update(libraryEntries)
    .set({ rating: latest?.final ?? null })
    .where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.gameId, gameId)))
    .run();
}

export interface RatingWriteResult {
  rating: RatingItem;
  item: LibraryItem;
}

export function createRating(
  ctx: ServiceContext,
  gameId: number,
  input: ParsedRatingInput,
): RatingWriteResult {
  const current = getLibraryItem(ctx, gameId);
  const settings = getSettings(ctx);
  if (input.completionId) assertCompletion(ctx.db, ctx.userId, gameId, input.completionId);

  const weights = resolveWeights(settings, input.preset, input.weights);
  const mode = input.mode ?? settings.ratingMode;
  const computed = computeRating({
    scores: input.scores,
    weights,
    enjoyment: input.enjoyment,
    mode,
    blendWeight: settings.ratingBlendWeight,
  });

  const row = ctx.db.transaction((tx) => {
    const inserted = tx
      .insert(ratings)
      .values({
        userId: ctx.userId,
        gameId,
        completionId: input.completionId ?? null,
        scores: input.scores,
        criterionNotes: nonEmptyNotes(input.criterionNotes),
        weights,
        preset: input.preset,
        enjoyment: input.enjoyment,
        weighted: computed.weighted,
        final: computed.final,
        mode,
        review: input.review || null,
        // Explícito (com milissegundos) para a ordem "mais recente" não empatar.
        createdAt: ctx.now.toISOString(),
        updatedAt: ctx.now.toISOString(),
      })
      .returning()
      .get();
    refreshRatingCache(tx, ctx.userId, gameId);
    logActivity(tx, ctx, "rating.add", {
      gameId,
      name: current.name,
      ratingId: inserted.id,
      final: inserted.final,
      mode,
    });
    return inserted;
  });

  return { rating: toItem(row), item: getLibraryItem(ctx, gameId) };
}

/** Reavalia: o que não vier fica como estava, e as notas são recalculadas. */
export function updateRating(
  ctx: ServiceContext,
  id: number,
  patch: UpdateRatingInput,
): RatingWriteResult {
  const existing = getRating(ctx, id);
  const settings = getSettings(ctx);
  if (patch.completionId) assertCompletion(ctx.db, ctx.userId, existing.gameId, patch.completionId);

  const preset = patch.preset ?? existing.preset;
  // Trocar o preset sem mandar pesos recalcula os pesos pelo preset novo.
  const weights =
    patch.weights ??
    (patch.preset !== undefined && patch.preset !== existing.preset
      ? resolveWeights(settings, preset, undefined)
      : existing.weights);
  const scores = patch.scores ?? existing.scores;
  const enjoyment = patch.enjoyment ?? existing.enjoyment;
  const mode = patch.mode ?? existing.mode;
  const computed = computeRating({
    scores,
    weights,
    enjoyment,
    mode,
    blendWeight: settings.ratingBlendWeight,
  });

  ctx.db.transaction((tx) => {
    tx.update(ratings)
      .set({
        scores,
        weights,
        preset,
        enjoyment,
        mode,
        weighted: computed.weighted,
        final: computed.final,
        ...(patch.criterionNotes !== undefined && {
          criterionNotes: nonEmptyNotes(patch.criterionNotes),
        }),
        ...(patch.review !== undefined && { review: patch.review || null }),
        ...(patch.completionId !== undefined && { completionId: patch.completionId }),
      })
      .where(and(eq(ratings.id, id), eq(ratings.userId, ctx.userId)))
      .run();
    refreshRatingCache(tx, ctx.userId, existing.gameId);
    logActivity(tx, ctx, "rating.update", {
      gameId: existing.gameId,
      ratingId: id,
      final: computed.final,
    });
  });

  return { rating: getRating(ctx, id), item: getLibraryItem(ctx, existing.gameId) };
}

export function deleteRating(
  ctx: ServiceContext,
  id: number,
): { removed: RatingItem; item: LibraryItem } {
  const existing = getRating(ctx, id);
  ctx.db.transaction((tx) => {
    tx.delete(ratings)
      .where(and(eq(ratings.id, id), eq(ratings.userId, ctx.userId)))
      .run();
    refreshRatingCache(tx, ctx.userId, existing.gameId);
    logActivity(tx, ctx, "rating.remove", {
      gameId: existing.gameId,
      ratingId: id,
      final: existing.final,
    });
  });
  return { removed: existing, item: getLibraryItem(ctx, existing.gameId) };
}

function nonEmptyNotes(notes: ParsedRatingInput["criterionNotes"]) {
  if (!notes) return null;
  const kept = Object.fromEntries(Object.entries(notes).filter(([, text]) => text));
  return Object.keys(kept).length > 0 ? kept : null;
}

// ---------------------------------------------------------------------------
// Leitura agregada: calibragem e médias por critério

interface LatestRatingRow {
  gameId: number;
  igdbId: number;
  name: string;
  scores: Rating["scores"];
  weights: Rating["weights"];
}

/**
 * A avaliação mais recente com critérios de cada jogo da biblioteca, da mais nova para a mais
 * antiga. Uma nota rápida (só de coração) depois não apaga os critérios da anterior.
 */
function latestRatingPerGame({ db, userId }: UserScope): LatestRatingRow[] {
  const rows = db
    .select({
      gameId: ratings.gameId,
      igdbId: games.igdbId,
      name: games.name,
      scores: ratings.scores,
      weights: ratings.weights,
    })
    .from(ratings)
    .innerJoin(games, eq(games.id, ratings.gameId))
    .innerJoin(
      libraryEntries,
      and(eq(libraryEntries.gameId, ratings.gameId), eq(libraryEntries.userId, userId)),
    )
    .where(eq(ratings.userId, userId))
    .orderBy(desc(ratings.createdAt), desc(ratings.id))
    .all();
  const byGame = new Map<number, LatestRatingRow>();
  for (const row of rows) {
    if (!byGame.has(row.gameId) && applicableCriteria(row.scores).length > 0)
      byGame.set(row.gameId, row);
  }
  return [...byGame.values()];
}

/**
 * Últimas notas dadas em cada critério (pela avaliação atual de cada jogo), para calibrar a nota
 * nova contra as anteriores. O jogo sendo avaliado fica de fora.
 */
export function getCalibration(
  scope: UserScope,
  { excludeGameId, limit = CALIBRATION_LIMIT }: { excludeGameId?: number; limit?: number } = {},
): Record<CriterionId, CalibrationEntry[]> {
  const latest = latestRatingPerGame(scope).filter((row) => row.gameId !== excludeGameId);
  return Object.fromEntries(
    criterionIds.map((id) => [
      id,
      latest
        .filter((row) => typeof row.scores[id] === "number")
        .slice(0, limit)
        .map((row) => entry(row, id)),
    ]),
  ) as Record<CriterionId, CalibrationEntry[]>;
}

const entry = (row: LatestRatingRow, id: CriterionId): CalibrationEntry => ({
  gameId: row.gameId,
  igdbId: row.igdbId,
  name: row.name,
  score: row.scores[id]!,
});

/**
 * Média de cada critério na biblioteca (avaliação atual de cada jogo), com o jogo de maior e o de
 * menor nota. Só os critérios avaliados em algum jogo; os de maior média primeiro.
 */
export function getCriteriaAverages(scope: UserScope): CriterionAverage[] {
  const latest = latestRatingPerGame(scope);
  return criterionIds
    .flatMap((id): CriterionAverage[] => {
      const rated = latest.filter((row) => typeof row.scores[id] === "number");
      if (rated.length === 0) return [];
      const scoreOf = (row: LatestRatingRow) => row.scores[id]!;
      // Empate: o mais recente (a lista já vem do mais novo para o mais antigo).
      const best = rated.reduce((a, b) => (scoreOf(b) > scoreOf(a) ? b : a));
      const worst = rated.reduce((a, b) => (scoreOf(b) < scoreOf(a) ? b : a));
      const sum = (f: (row: LatestRatingRow) => number) =>
        rated.reduce((total, row) => total + f(row), 0);
      return [
        {
          criterion: id,
          average: sum(scoreOf) / rated.length,
          count: rated.length,
          averageWeight: sum((row) => row.weights[id] ?? DEFAULT_WEIGHTS[id]) / rated.length,
          best: entry(best, id),
          worst: rated.length > 1 ? entry(worst, id) : null,
        },
      ];
    })
    .toSorted((a, b) => b.average - a.average || b.count - a.count);
}

/** Tudo que o formulário (ou a IA, pelo MCP) precisa para começar uma avaliação. */
export function getRatingTemplate(scope: UserScope, gameId?: number): RatingTemplate {
  const settings = getSettings(scope);
  const item = gameId === undefined ? null : getLibraryItem(scope, gameId);
  return {
    baseWeights: baseWeights(settings),
    customWeights: settings.ratingCustomWeights !== null,
    suggestedPreset: item ? suggestPreset(item) : "default",
    mode: settings.ratingMode,
    blendWeight: settings.ratingBlendWeight,
    calibration: getCalibration(scope, { excludeGameId: gameId }),
    latest: gameId === undefined ? null : getLatestRating(scope, gameId),
  };
}

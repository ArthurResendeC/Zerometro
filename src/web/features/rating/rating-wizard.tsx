import { useForm, useStore } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useId, useState } from "react";
import type { CompletionItem } from "@shared/completions";
import { completionTypeLabels } from "@shared/domain";
import type { LibraryItem } from "@shared/library";
import {
  type Criterion,
  criterionGroupLabels,
  type CriterionId,
  type CriterionWeights,
  presetDefs,
  presetNotApplicable,
  presetWeights,
  ratingCriteria,
  type RatingPreset,
  ratingPresets,
} from "@shared/rating-criteria";
import {
  computeRating,
  DIVERGENCE_MESSAGE,
  formatScore,
  MIN_APPLICABLE_CRITERIA,
  type RatingInput,
  type RatingMode,
  ratingModeShortLabels,
  ratingModes,
  type RatingTemplate,
} from "@shared/ratings";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, StarIcon } from "@/components/icons";
import { SegmentedToggle } from "@/components/segmented-toggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { XpBar } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { useUpdateSettings } from "@/lib/queries";
import { cn } from "@/lib/utils";
import {
  draftScores,
  draftToInput,
  ENJOYMENT_STEP,
  initialDraft,
  INTRO_STEP,
  SUMMARY_STEP,
} from "./rating-draft";
import { type RatingDraft, useRatingDrafts } from "./rating-draft-store";
import { RatingRadar } from "./rating-radar";
import { ScoreScale } from "./score-scale";

// Avaliação guiada em passos: introdução (preset e playthrough), um passo por critério, a nota
// de coração e o resumo (radar, as três notas, pesos e review). O estado fica no TanStack Form
// e o rascunho, neste aparelho (fechar a aba não perde o que já foi respondido).

/** Máximo do slider de peso (a API aceita até `MAX_CRITERION_WEIGHT`). */
const WEIGHT_SLIDER_MAX = 30;

const criterionAt = (step: number): Criterion | undefined => ratingCriteria[step - 1];

interface RatingWizardProps {
  item: LibraryItem;
  template: RatingTemplate;
  completions: CompletionItem[];
  /** Começa direto na nota de coração ("Só quero dar uma nota"). */
  quickStart?: boolean;
  saving: boolean;
  onSave: (input: RatingInput) => Promise<unknown>;
}

export function RatingWizard({
  item,
  template,
  completions,
  quickStart = false,
  saving,
  onSave,
}: RatingWizardProps) {
  const saved = useRatingDrafts((s) => s.drafts[item.gameId]);
  const saveDraft = useRatingDrafts((s) => s.save);
  const discardDraft = useRatingDrafts((s) => s.discard);
  // O rascunho só vale na primeira montagem (depois, quem manda é o formulário).
  const [restored] = useState(() => (quickStart ? undefined : saved));
  const fresh = () => {
    const base = initialDraft(template, completions);
    return quickStart ? { ...base, quick: true, step: ENJOYMENT_STEP } : base;
  };

  const form = useForm({
    defaultValues: restored ?? fresh(),
    onSubmit: async ({ value }) => {
      await onSave(draftToInput(value));
      discardDraft(item.gameId);
    },
  });
  const values = useStore(form.store, (s) => s.values);
  const set = <K extends keyof RatingDraft>(key: K, value: RatingDraft[K]) =>
    form.setFieldValue(key, value as never);

  // Só vira rascunho depois de começar (abrir e fechar a introdução não deixa nada para trás).
  useEffect(() => {
    if (values.step !== INTRO_STEP) saveDraft(item.gameId, values);
  }, [item.gameId, values, saveDraft]);

  const step = values.step;
  const goTo = (next: number) => {
    set("step", next);
    window.scrollTo({ top: 0 });
  };
  const next = () => goTo(values.quick && step === INTRO_STEP ? ENJOYMENT_STEP : step + 1);
  const back = () => goTo(values.quick && step === ENJOYMENT_STEP ? INTRO_STEP : step - 1);

  function restart() {
    discardDraft(item.gameId);
    form.reset(fresh());
  }

  const criterion = criterionAt(step);
  const totalSteps = values.quick ? 2 : SUMMARY_STEP;
  const progressStep = values.quick ? (step === INTRO_STEP ? 0 : 1) : step;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className="space-y-5"
    >
      <div className="flex items-center gap-3">
        <XpBar
          value={(progressStep / totalSteps) * 100}
          cells={values.quick ? 2 : 15}
          label="Progresso da avaliação"
        />
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {criterion ? `${step} de ${ratingCriteria.length}` : stepTitle(step)}
        </span>
      </div>

      {restored && step > INTRO_STEP && (
        <p className="text-xs text-muted-foreground">
          Rascunho recuperado deste aparelho.{" "}
          <button type="button" onClick={restart} className="cursor-pointer text-info underline">
            Recomeçar
          </button>
        </p>
      )}

      {step === INTRO_STEP && (
        <IntroStep
          item={item}
          template={template}
          completions={completions}
          draft={values}
          onPreset={(preset) => {
            set("preset", preset);
            set("weights", presetWeights(preset, template.baseWeights));
            // Só mexe no "Não se aplica" de quem ainda não tem nota.
            const answered = new Set(Object.keys(values.scores));
            set(
              "notApplicable",
              presetNotApplicable(preset).filter((id) => !answered.has(id)),
            );
          }}
          onCompletion={(id) => set("completionId", id)}
          onStart={() => {
            set("quick", false);
            goTo(1);
          }}
          onQuick={() => {
            set("quick", true);
            goTo(ENJOYMENT_STEP);
          }}
        />
      )}

      {criterion && (
        <CriterionStep
          key={criterion.id}
          criterion={criterion}
          template={template}
          draft={values}
          onScore={(score) => {
            set("scores", { ...values.scores, [criterion.id]: score });
            set(
              "notApplicable",
              values.notApplicable.filter((id) => id !== criterion.id),
            );
          }}
          onNotApplicable={() => {
            const { [criterion.id]: _, ...rest } = values.scores;
            set("scores", rest);
            if (!values.notApplicable.includes(criterion.id))
              set("notApplicable", [...values.notApplicable, criterion.id]);
          }}
          onNote={(text) =>
            set("criterionNotes", { ...values.criterionNotes, [criterion.id]: text })
          }
          onBack={back}
          onNext={next}
        />
      )}

      {step === ENJOYMENT_STEP && (
        <EnjoymentStep
          value={values.enjoyment}
          onChange={(v) => set("enjoyment", v)}
          quick={values.quick}
          saving={saving}
          onBack={back}
          onNext={next}
        />
      )}

      {step === SUMMARY_STEP && (
        <SummaryStep
          template={template}
          draft={values}
          saving={saving}
          onMode={(mode) => set("mode", mode)}
          onWeights={(weights) => {
            set("weights", weights);
            set("preset", "custom");
          }}
          onResetWeights={() => {
            const preset = values.preset === "custom" ? template.suggestedPreset : values.preset;
            set("preset", preset);
            set("weights", presetWeights(preset, template.baseWeights));
          }}
          onReview={(text) => set("review", text)}
          onReviewCriteria={() => goTo(1)}
          onBack={back}
        />
      )}
    </form>
  );
}

function stepTitle(step: number) {
  if (step === INTRO_STEP) return "Início";
  if (step === ENJOYMENT_STEP) return "Coração";
  return "Resumo";
}

// ---------------------------------------------------------------------------
// Introdução

function IntroStep({
  item,
  template,
  completions,
  draft,
  onPreset,
  onCompletion,
  onStart,
  onQuick,
}: {
  item: LibraryItem;
  template: RatingTemplate;
  completions: CompletionItem[];
  draft: RatingDraft;
  onPreset: (preset: RatingPreset) => void;
  onCompletion: (id: number | null) => void;
  onStart: () => void;
  onQuick: () => void;
}) {
  const presetId = useId();
  const completionId = useId();
  const firstTime =
    template.latest === null && Object.values(template.calibration).every((c) => c.length === 0);
  const choosable = ratingPresets.filter((p) => p !== "custom");

  return (
    <Card className="space-y-5">
      <div className="space-y-2">
        <h1 className="display-md">Avaliar {item.name}</h1>
        {firstTime ? (
          <p className="text-sm text-muted-foreground">
            Uma pergunta por critério, de 1 a 7, sobre como o jogo funciona e como você se sentiu
            jogando. No fim, a sua nota de coração. Leva uns 2 minutos, e a nota mede a <em>sua</em>{" "}
            experiência, não a "qualidade objetiva" do jogo.{" "}
            <Link to="/como-avaliamos" className="text-info underline">
              Como avaliamos
            </Link>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {ratingCriteria.length} critérios de 1 a 7 e a nota de coração.{" "}
            <Link to="/como-avaliamos" className="text-info underline">
              Como avaliamos
            </Link>
          </p>
        )}
      </div>

      <div className={cn("grid gap-4", completions.length > 0 && "sm:grid-cols-2")}>
        <div className="space-y-2">
          <Label htmlFor={presetId}>Tipo de jogo (pesos)</Label>
          <NativeSelect
            id={presetId}
            value={draft.preset === "custom" ? template.suggestedPreset : draft.preset}
            onChange={(e) => onPreset(e.target.value as RatingPreset)}
          >
            {choosable.map((p) => (
              <option key={p} value={p}>
                {presetDefs[p].label}
                {p === template.suggestedPreset ? " (sugerido)" : ""}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            {
              presetDefs[draft.preset === "custom" ? template.suggestedPreset : draft.preset]
                .description
            }
          </p>
        </div>

        {completions.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor={completionId}>Playthrough</Label>
            <NativeSelect
              id={completionId}
              value={draft.completionId?.toString() ?? ""}
              onChange={(e) => onCompletion(e.target.value ? Number(e.target.value) : null)}
            >
              {completions.map((c) => (
                <option key={c.id} value={c.id}>
                  {completionTypeLabels[c.type]} em {formatDate(c.completedOn)}
                </option>
              ))}
              <option value="">Nenhum em especial</option>
            </NativeSelect>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center">
        <Button type="button" onClick={onStart}>
          Começar <ArrowRightIcon />
        </Button>
        <Button type="button" variant="link" onClick={onQuick}>
          Só quero dar uma nota
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Um critério

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

function CriterionStep({
  criterion,
  template,
  draft,
  onScore,
  onNotApplicable,
  onNote,
  onBack,
  onNext,
}: {
  criterion: Criterion;
  template: RatingTemplate;
  draft: RatingDraft;
  onScore: (score: number) => void;
  onNotApplicable: () => void;
  onNote: (text: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const score = draft.scores[criterion.id] ?? null;
  const notApplicable = draft.notApplicable.includes(criterion.id);
  const answered = score !== null || notApplicable;
  const note = draft.criterionNotes[criterion.id] ?? "";
  const [showNote, setShowNote] = useState(note !== "");
  const noteId = useId();
  const calibration = template.calibration[criterion.id];
  const previous = template.latest?.scores[criterion.id];

  // Atalhos: 1–7 dão a nota, N marca "Não se aplica", Enter avança.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (/^[1-7]$/.test(e.key)) onScore(Number(e.key));
      else if (e.key.toLowerCase() === "n") onNotApplicable();
      else if (e.key === "Enter" && answered) {
        e.preventDefault();
        onNext();
      } else return;
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onScore, onNotApplicable, onNext, answered]);

  return (
    <Card className="space-y-5">
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">{criterionGroupLabels[criterion.group]}</p>
        <h1 className="display-md">{criterion.label}</h1>
        <p className="text-lg">{criterion.question}</p>
      </div>

      <ScoreScale
        label={criterion.question}
        value={score}
        notApplicable={notApplicable}
        onChange={onScore}
        onNotApplicable={onNotApplicable}
        low={criterion.low}
        high={criterion.high}
      />

      {(calibration.length > 0 || typeof previous === "number") && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Para calibrar, suas notas recentes:</p>
          <ul className="flex flex-wrap gap-1.5">
            {typeof previous === "number" && (
              <li className="bg-muted px-2 py-1 text-xs">
                Avaliação anterior deste jogo: {previous}
              </li>
            )}
            {calibration.map((entry) => (
              <li key={entry.gameId} className="bg-muted px-2 py-1 text-xs">
                {entry.name}: {entry.score}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="group text-sm">
        <summary className="cursor-pointer text-info">Por que isso importa?</summary>
        <div className="mt-2 space-y-2 text-muted-foreground">
          <p>{criterion.why}</p>
          <p>
            <span className="text-foreground">Exemplo:</span> {criterion.example}
          </p>
        </div>
      </details>

      {showNote ? (
        <div className="space-y-2">
          <Label htmlFor={noteId}>Comentário (opcional)</Label>
          <Textarea
            id={noteId}
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => onNote(e.target.value)}
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="link"
          className="self-start"
          onClick={() => setShowNote(true)}
        >
          Adicionar comentário
        </Button>
      )}

      <StepNav onBack={onBack}>
        <Button type="button" onClick={onNext} disabled={!answered}>
          Próximo <ArrowRightIcon />
        </Button>
      </StepNav>
    </Card>
  );
}

function StepNav({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between">
      <Button type="button" variant="outline" onClick={onBack}>
        <ArrowLeftIcon /> Voltar
      </Button>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nota de coração

function EnjoymentStep({
  value,
  onChange,
  quick,
  saving,
  onBack,
  onNext,
}: {
  value: number;
  onChange: (value: number) => void;
  quick: boolean;
  saving: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <Card className="space-y-6">
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Nota de coração</p>
        <h1 className="display-md">No geral, quanto você gostou?</h1>
        <p className="text-sm text-muted-foreground">
          Sem pensar nos critérios: a intuição, de 0 a 10.
        </p>
      </div>
      <p className="text-center display-xl tabular-nums" aria-live="polite">
        {value.toLocaleString("pt-BR")}
      </p>
      <Slider
        thumbLabel="Nota de coração"
        min={0}
        max={10}
        step={0.5}
        value={[value]}
        onValueChange={([v = value]) => onChange(v)}
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>0</span>
        <span>10</span>
      </div>
      <StepNav onBack={onBack}>
        {quick ? (
          <Button type="submit" disabled={saving}>
            <CheckIcon /> {saving ? "Salvando…" : "Salvar nota"}
          </Button>
        ) : (
          <Button type="button" onClick={onNext}>
            Ver resumo <ArrowRightIcon />
          </Button>
        )}
      </StepNav>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Resumo

const modeOptions = ratingModes.map((mode) => ({
  value: mode,
  label: ratingModeShortLabels[mode],
}));

function SummaryStep({
  template,
  draft,
  saving,
  onMode,
  onWeights,
  onResetWeights,
  onReview,
  onReviewCriteria,
  onBack,
}: {
  template: RatingTemplate;
  draft: RatingDraft;
  saving: boolean;
  onMode: (mode: RatingMode) => void;
  onWeights: (weights: CriterionWeights) => void;
  onResetWeights: () => void;
  onReview: (text: string) => void;
  onReviewCriteria: () => void;
  onBack: () => void;
}) {
  const reviewId = useId();
  const scores = draftScores(draft);
  const result = computeRating({
    scores,
    weights: draft.weights,
    enjoyment: draft.enjoyment,
    mode: draft.mode,
    blendWeight: template.blendWeight,
  });

  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <h1 className="display-md">Resumo</h1>
        <RatingRadar scores={scores} caption="Notas por critério, de 1 a 7" />

        <dl className="grid grid-cols-3 gap-2 text-center">
          <ScoreTile
            label="Calculada"
            value={result.weighted === null ? "—" : formatScore(result.weighted)}
          />
          <ScoreTile label="Coração" value={formatScore(result.gut)} />
          <ScoreTile label="Final" value={formatScore(result.final)} highlight />
        </dl>

        {result.weighted === null && (
          <p className="text-sm text-muted-foreground">
            Com menos de {MIN_APPLICABLE_CRITERIA} critérios avaliados não há nota calculada: a
            final é a de coração.
          </p>
        )}

        {result.divergent && (
          <output className="block space-y-2 bg-muted p-3 text-sm">
            <p>{DIVERGENCE_MESSAGE}</p>
            <div className="flex flex-wrap">
              <Button type="button" size="sm" variant="outline" onClick={onReviewCriteria}>
                Revisar critérios
              </Button>
              {draft.mode !== "gut" && (
                <Button type="button" size="sm" variant="outline" onClick={() => onMode("gut")}>
                  Usar a de coração
                </Button>
              )}
            </div>
          </output>
        )}

        {result.weighted !== null && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Nota final</p>
            <SegmentedToggle
              legend="Como sai a nota final"
              options={modeOptions}
              value={draft.mode}
              onChange={onMode}
            />
            {draft.mode === "blend" && (
              <p className="text-xs text-muted-foreground">
                {Math.round(template.blendWeight * 100)}% calculada +{" "}
                {Math.round((1 - template.blendWeight) * 100)}% coração (mude em Ajustes)
              </p>
            )}
          </div>
        )}
      </Card>

      {result.weighted !== null && (
        <WeightsEditor
          draft={draft}
          template={template}
          onWeights={onWeights}
          onReset={onResetWeights}
        />
      )}

      <Card className="space-y-2">
        <Label htmlFor={reviewId}>Review (opcional)</Label>
        <Textarea
          id={reviewId}
          rows={4}
          maxLength={5000}
          placeholder="O que ficou desse jogo para você?"
          value={draft.review}
          onChange={(e) => onReview(e.target.value)}
        />
      </Card>

      <StepNav onBack={onBack}>
        <Button type="submit" disabled={saving}>
          <StarIcon /> {saving ? "Salvando…" : "Salvar avaliação"}
        </Button>
      </StepNav>
    </div>
  );
}

function ScoreTile({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "m-0.5 space-y-1 px-2 py-3 pixel-frame-thin",
        highlight ? "bg-primary text-primary-foreground" : "bg-card",
      )}
    >
      <dt className={cn("text-xs", highlight ? "" : "text-muted-foreground")}>{label}</dt>
      <dd className="display-lg tabular-nums">{value}</dd>
    </div>
  );
}

function WeightsEditor({
  draft,
  template,
  onWeights,
  onReset,
}: {
  draft: RatingDraft;
  template: RatingTemplate;
  onWeights: (weights: CriterionWeights) => void;
  onReset: () => void;
}) {
  const updateSettings = useUpdateSettings();
  const applicable = ratingCriteria.filter(
    (c) => !draft.notApplicable.includes(c.id) && draft.scores[c.id] !== undefined,
  );
  const total = applicable.reduce((sum, c) => sum + draft.weights[c.id], 0);
  const setWeight = (id: CriterionId, value: number) =>
    onWeights({ ...draft.weights, [id]: value });

  return (
    <Card>
      <details>
        <summary className="cursor-pointer display-xs">
          Pesos · {presetDefs[draft.preset].label}
        </summary>
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Quanto cada critério conta na nota calculada (a parte de cada um é o peso dividido pela
            soma dos avaliados). A nota recalcula enquanto você mexe.
          </p>
          <ul className="space-y-3">
            {applicable.map((c) => (
              <li key={c.id} className="space-y-1.5">
                <div className="flex justify-between gap-2 text-sm">
                  <span>{c.label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {draft.weights[c.id].toLocaleString("pt-BR")}
                    {total > 0 && ` · ${Math.round((draft.weights[c.id] / total) * 100)}%`}
                  </span>
                </div>
                <Slider
                  thumbLabel={`Peso de ${c.label}`}
                  min={0}
                  max={WEIGHT_SLIDER_MAX}
                  step={1}
                  value={[draft.weights[c.id]]}
                  onValueChange={([v = 0]) => setWeight(c.id, v)}
                />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap">
            <Button type="button" size="sm" variant="outline" onClick={onReset}>
              Voltar aos pesos do preset
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={updateSettings.isPending}
              onClick={() => updateSettings.mutate({ ratingCustomWeights: draft.weights })}
            >
              Usar estes pesos como padrão
            </Button>
            {template.customWeights && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={updateSettings.isPending}
                onClick={() => updateSettings.mutate({ ratingCustomWeights: null })}
              >
                Voltar ao padrão do método
              </Button>
            )}
          </div>
        </div>
      </details>
    </Card>
  );
}

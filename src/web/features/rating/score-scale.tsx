import { SCORE_MAX, SCORE_MIN } from "@shared/rating-criteria";
import { cn } from "@/lib/utils";

const scores = Array.from({ length: SCORE_MAX - SCORE_MIN + 1 }, (_, i) => SCORE_MIN + i);

interface ScoreScaleProps {
  /** Nota escolhida (null = nenhuma ainda ou "Não se aplica"). */
  value: number | null;
  notApplicable: boolean;
  onChange: (score: number) => void;
  onNotApplicable: () => void;
  low: string;
  high: string;
  /** Nome acessível do grupo (a pergunta). */
  label: string;
}

/** Escala 1–7 em botões grandes, com o significado dos extremos e o "Não se aplica". */
export function ScoreScale({
  value,
  notApplicable,
  onChange,
  onNotApplicable,
  low,
  high,
  label,
}: ScoreScaleProps) {
  return (
    <div className="space-y-3">
      <fieldset className="grid grid-cols-7 gap-1.5 sm:gap-2">
        <legend className="sr-only">{label}</legend>
        {scores.map((score) => {
          const active = !notApplicable && value === score;
          return (
            <button
              key={score}
              type="button"
              aria-pressed={active}
              aria-keyshortcuts={String(score)}
              onClick={() => onChange(score)}
              className={cn(
                "m-0.5 flex aspect-square max-h-16 w-full cursor-pointer items-center justify-center display-md tabular-nums pixel-frame-thin transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-card hover:bg-accent focus-visible:bg-accent",
              )}
            >
              {score}
            </button>
          );
        })}
      </fieldset>
      <div className="flex justify-between gap-4 text-xs text-muted-foreground">
        <p className="max-w-[45%]">
          <span className="text-foreground">1</span> = {low}
        </p>
        <p className="max-w-[45%] text-right">
          <span className="text-foreground">7</span> = {high}
        </p>
      </div>
      <button
        type="button"
        aria-pressed={notApplicable}
        aria-keyshortcuts="N"
        onClick={onNotApplicable}
        className={cn(
          "m-0.5 cursor-pointer px-3 py-2 text-sm pixel-frame-thin transition-colors",
          notApplicable
            ? "bg-secondary text-secondary-foreground"
            : "bg-card text-muted-foreground hover:bg-accent",
        )}
      >
        Não se aplica
      </button>
    </div>
  );
}

import { useId, useState } from "react";
import {
  defaultProgressGoal,
  MAX_GOAL_MINUTES,
  type ProgressGoal,
  progressGoalLabels,
  progressGoals,
} from "@shared/completions";
import type { LibraryItem } from "@shared/library";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useUpdateLibraryEntry } from "@/lib/queries";

type Choice = ProgressGoal | "default";

const choiceLabels: Record<ProgressGoal, string> = {
  ...progressGoalLabels,
  hours: "Em horas",
};

/** "40" → 2400; "12,5" → 750. null se não for um alvo válido (1h a 9999h). */
function parseHours(text: string): number | null {
  const hours = Number(text.trim().replace(",", "."));
  if (!Number.isFinite(hours) || hours < 1) return null;
  const minutes = Math.round(hours * 60);
  return minutes <= MAX_GOAL_MINUTES ? minutes : null;
}

/**
 * Até onde a barra mede: a meta padrão do status, um nível de conclusão, um alvo em horas ou
 * nenhum. Salva ao escolher (as horas, ao confirmar). Remonte com `key={item.updatedAt}`.
 */
export function ProgressGoalControl({ item }: { item: LibraryItem }) {
  const update = useUpdateLibraryEntry(item.gameId);
  const id = useId();
  const [choice, setChoice] = useState<Choice>(
    item.progressGoalCustom ? item.progressGoal : "default",
  );
  const savedMinutes = item.progressGoal === "hours" ? item.progressTargetMinutes : null;
  const [hours, setHours] = useState(savedMinutes ? String(savedMinutes / 60) : "");
  const minutes = parseHours(hours);
  const defaultGoal = defaultProgressGoal(item.status);

  function choose(next: Choice) {
    setChoice(next);
    // Horas só salvam com o número: no Enter ou em "Salvar".
    if (next === "hours") return;
    update.mutate({ progressGoal: next === "default" ? null : next });
  }

  function saveHours(event: React.FormEvent) {
    event.preventDefault();
    if (minutes === null) return;
    update.mutate({ progressGoal: "hours", progressGoalMinutes: minutes });
  }

  const noTime =
    item.progress === null && item.progressGoal !== "none" && item.progressGoal !== "hours";

  return (
    <form className="space-y-2" onSubmit={saveHours}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor={id} className="display-xs text-muted-foreground">
          Meta da barra
        </label>
        <NativeSelect
          id={id}
          className="w-auto"
          value={choice}
          disabled={update.isPending}
          onChange={(e) => choose(e.target.value as Choice)}
        >
          <option value="default">Padrão ({progressGoalLabels[defaultGoal]})</option>
          {progressGoals.map((goal) => (
            <option key={goal} value={goal}>
              {choiceLabels[goal]}
            </option>
          ))}
        </NativeSelect>
        {choice === "hours" && (
          <>
            <div className="flex items-center gap-2">
              <Input
                className="w-24"
                inputMode="decimal"
                autoComplete="off"
                aria-label="Horas da meta"
                aria-invalid={hours.trim() !== "" && minutes === null}
                placeholder="500"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
              <span className="text-sm text-muted-foreground">h</span>
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={minutes === null || minutes === savedMinutes || update.isPending}
            >
              Salvar
            </Button>
          </>
        )}
      </div>
      {noTime && (
        <p className="text-xs text-muted-foreground">
          O IGDB não tem tempo para essa meta: escolha uma meta em horas para ver a barra.
        </p>
      )}
    </form>
  );
}

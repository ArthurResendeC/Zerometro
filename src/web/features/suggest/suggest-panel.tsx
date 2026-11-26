import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { todayIn } from "@shared/dates";
import {
  type AvailableTime,
  availableTimeLabels,
  availableTimes,
  type Mood,
  moodLabels,
  moods,
  pickSuggestion,
  type Suggestion,
  suggestGames,
} from "@shared/suggest";
import { GameCover } from "@/components/game-cover";
import { PlayIcon } from "@/components/icons";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { libraryListQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Roulette } from "./roulette";
import { useSuggestPrefs } from "./suggest-prefs-store";

// Aba "Me sugere" do botão Jogar: tempo disponível + clima → 3 sugestões com o motivo, e a
// roleta para sortear. Roda no aparelho (funciona offline com a biblioteca guardada).

interface SuggestPanelProps {
  /** Liga o timer do jogo escolhido (a mesma regra da lista "Escolher"). */
  onPlay: (gameId: number) => void;
  disabled?: boolean;
}

export function SuggestPanel({ onPlay, disabled }: SuggestPanelProps) {
  const library = useQuery(libraryListQuery());
  const prefs = useSuggestPrefs();
  /** Sorteio em andamento ou concluído (a `round` remonta a roleta a cada sorteio). */
  const [draw, setDraw] = useState<{ picked: Suggestion; round: number; done: boolean } | null>(
    null,
  );

  const items = useMemo(() => library.data?.items ?? [], [library.data]);
  const platforms = useMemo(
    () =>
      [...new Set(items.flatMap((i) => (i.platformPlayed ? [i.platformPlayed] : [])))].toSorted(),
    [items],
  );
  const platform = prefs.platform && platforms.includes(prefs.platform) ? prefs.platform : null;
  const { top, pool } = useMemo(
    () =>
      suggestGames(items, {
        available: prefs.available ?? undefined,
        mood: prefs.mood ?? undefined,
        platform: platform ?? undefined,
        today: todayIn(),
      }),
    [items, prefs.available, prefs.mood, platform],
  );

  const spin = () => {
    const picked = pickSuggestion(pool);
    if (picked) setDraw({ picked, round: (draw?.round ?? 0) + 1, done: false });
  };

  if (library.isPending) return <p className="text-muted-foreground">Carregando…</p>;

  return (
    <div className="grid min-w-0 gap-4">
      <ChipRow
        label="Quanto tempo você tem?"
        options={availableTimes.map((value) => ({ value, label: availableTimeLabels[value] }))}
        value={prefs.available}
        onToggle={(value: AvailableTime) => {
          prefs.toggleAvailable(value);
          setDraw(null);
        }}
      />
      <ChipRow
        label="Clima"
        options={moods.map((value) => ({ value, label: moodLabels[value] }))}
        value={prefs.mood}
        onToggle={(value: Mood) => {
          prefs.toggleMood(value);
          setDraw(null);
        }}
      />
      {platforms.length > 1 && (
        <NativeSelect
          aria-label="Plataforma"
          value={platform ?? ""}
          onChange={(e) => {
            prefs.setPlatform(e.target.value || null);
            setDraw(null);
          }}
          className="w-60 max-w-full"
        >
          <option value="">Qualquer plataforma</option>
          {platforms.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </NativeSelect>
      )}

      {top.length === 0 ? (
        <p className="py-2 text-muted-foreground">
          {prefs.mood === "coop"
            ? "Nenhum jogo com coop em andamento ou nos próximos."
            : "Nenhum jogo em andamento, nos próximos ou pausado combina com isso."}
        </p>
      ) : draw ? (
        <div className="grid min-w-0 gap-3">
          <Roulette
            key={draw.round}
            pool={pool}
            picked={draw.picked}
            onDone={() => setDraw((d) => d && { ...d, done: true })}
          />
          {draw.done && (
            <SuggestionRow suggestion={draw.picked} onPlay={onPlay} disabled={disabled} highlight />
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={spin} disabled={!draw.done}>
              Sortear de novo
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraw(null)}>
              Ver as sugestões
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid min-w-0 gap-3">
          <ul className="grid min-w-0 gap-1">
            {top.map((suggestion) => (
              <li key={suggestion.item.gameId}>
                <SuggestionRow suggestion={suggestion} onPlay={onPlay} disabled={disabled} />
              </li>
            ))}
          </ul>
          {pool.length > 1 && (
            <Button size="sm" variant="outline" className="justify-self-start" onClick={spin}>
              🎰 Sortear
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ChipRow<T extends string>({
  label,
  options,
  value,
  onToggle,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onToggle: (value: T) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 display-xs text-muted-foreground">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={value === option.value ? "default" : "outline"}
            aria-pressed={value === option.value}
            onClick={() => onToggle(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

function SuggestionRow({
  suggestion: { item, reasons },
  onPlay,
  disabled,
  highlight = false,
}: {
  suggestion: Suggestion;
  onPlay: (gameId: number) => void;
  disabled?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3 p-2",
        highlight && "m-1 bg-accent pixel-frame",
      )}
    >
      <GameCover
        name={item.name}
        imageId={item.coverImageId}
        size="thumb"
        className="w-10 shrink-0"
      />
      <div className="grid min-w-0 flex-1 gap-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate">{item.name}</span>
          <StatusBadge status={item.displayState} className="shrink-0" />
        </span>
        {reasons.length > 0 && (
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {reasons.slice(0, 2).join(" · ")}
          </span>
        )}
      </div>
      <Button size="sm" onClick={() => onPlay(item.gameId)} disabled={disabled}>
        <PlayIcon /> <span className="max-sm:sr-only">Jogar este</span>
      </Button>
    </div>
  );
}

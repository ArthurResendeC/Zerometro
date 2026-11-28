import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { addDays, diffInDays } from "@shared/dates";
import { completionTypeLabels } from "@shared/domain";
import {
  type Timeline,
  type TimelineCompletion,
  type TimelineGame,
  type TimelinePause,
  type TimelineSpan,
  timelinePauses,
} from "@shared/timeline";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChartTooltipBox } from "@/components/ui/chart";
import { formatDate, formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMarkTooltip } from "./use-mark-tooltip";

// Linha do tempo estilo Gantt: uma linha por jogo, uma barra por trecho jogado sem pausa, um
// tracejado nas pausas de mais de 14 dias e um losango em cada conclusão. Posições em % do
// período, então o desenho acompanha a largura sem rolar de lado.

/** Linhas mostradas antes do "Ver todos". */
const ROWS_SHOWN = 15;

const monthShort = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });

type Mark =
  | { kind: "span"; game: TimelineGame; span: TimelineSpan }
  | { kind: "pause"; game: TimelineGame; pause: TimelinePause }
  | { kind: "completion"; game: TimelineGame; completion: TimelineCompletion };

/** Primeiro dia de cada mês dentro do período. */
function monthStarts(from: string, to: string): string[] {
  const months: string[] = [];
  let month = from.endsWith("-01")
    ? from
    : `${addDays(`${from.slice(0, 7)}-28`, 4).slice(0, 7)}-01`;
  while (month <= to) {
    months.push(month);
    month = `${addDays(`${month.slice(0, 7)}-28`, 4).slice(0, 7)}-01`;
  }
  return months;
}

/**
 * Os jogos que cabem: primeiro os zerados no período, depois os mais jogados. A ordem na tela
 * continua a de quando cada um apareceu.
 */
function pickRows(games: TimelineGame[], limit: number): TimelineGame[] {
  if (games.length <= limit) return games;
  const kept = new Set(
    games
      .toSorted(
        (a, b) =>
          Number(b.completions.length > 0) - Number(a.completions.length > 0) ||
          b.minutes - a.minutes,
      )
      .slice(0, limit),
  );
  return games.filter((game) => kept.has(game));
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** `person`: o nome de quem está sendo visto (sem ele, o texto fala com "você"). */
export function TimelineSection({ timeline, person }: { timeline: Timeline; person?: string }) {
  const [showAll, setShowAll] = useState(false);
  const tooltip = useMarkTooltip<Mark>();
  const { from, to, today, games } = timeline;
  const period = timeline.year ? `em ${timeline.year}` : "nos últimos 12 meses";
  const total = diffInDays(from, to) + 1;
  /** Começo do dia, em % do período. */
  const at = (date: string) => (diffInDays(from, date) / total) * 100;
  const months = monthStarts(from, to);
  const rows = showAll ? games : pickRows(games, ROWS_SHOWN);
  const future = today < to ? at(addDays(today, 1)) : null;

  const track = (game: TimelineGame) => {
    const pauses = timelinePauses(game.spans);
    return (
      <div className="relative h-5" onPointerLeave={tooltip.onPointerLeave}>
        {months.map((month) => (
          <span
            key={month}
            aria-hidden
            className="absolute inset-y-0 w-px bg-muted"
            style={{ left: `${at(month)}%` }}
          />
        ))}
        {future !== null && (
          <span
            aria-hidden
            className="absolute inset-y-0 right-0 bg-muted/50"
            style={{ left: `${future}%` }}
          />
        )}
        {pauses.map((pause) => {
          const key = `${game.gameId}-p-${pause.resumedOn}`;
          const left = at(addDays(pause.lastPlayedOn, 1));
          return (
            <span
              key={key}
              {...tooltip.mark(key, { kind: "pause", game, pause })}
              className="group absolute inset-y-0 flex items-center"
              style={{ left: `${left}%`, width: `${at(pause.resumedOn) - left}%` }}
            >
              <span
                className={cn(
                  "w-full border-t-(length:--rule) border-dashed border-muted-foreground/60 group-hover:border-foreground",
                  tooltip.isPinned(key) && "border-foreground",
                )}
              />
            </span>
          );
        })}
        {game.spans.map((span) => {
          const key = `${game.gameId}-s-${span.from}`;
          return (
            <span
              key={key}
              {...tooltip.mark(key, { kind: "span", game, span })}
              className="absolute inset-y-0 flex items-center"
              style={{
                left: `${at(span.from)}%`,
                width: `${((diffInDays(span.from, span.to) + 1) / total) * 100}%`,
              }}
            >
              <span
                className={cn(
                  "h-2.5 w-full min-w-1 bg-chart-2 hover:brightness-125",
                  tooltip.isPinned(key) && "outline-2 outline-offset-1 outline-foreground",
                )}
              />
            </span>
          );
        })}
        {game.completions.map((completion, i) => {
          const key = `${game.gameId}-c-${i}`;
          return (
            <span
              key={key}
              {...tooltip.mark(key, { kind: "completion", game, completion })}
              className="absolute inset-y-0 flex w-5 -translate-x-1/2 items-center justify-center"
              style={{ left: `${at(completion.completedOn) + 50 / total}%` }}
            >
              <span
                className={cn(
                  "size-2.5 rotate-45 bg-primary ring-2 ring-card hover:brightness-125",
                  tooltip.isPinned(key) && "outline-2 outline-offset-1 outline-foreground",
                )}
              />
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <section className="space-y-4" aria-labelledby="linha-do-tempo">
      <h2 id="linha-do-tempo" className="display-md">
        Linha do tempo
      </h2>
      <Card className="gap-4">
        <p className="text-xs text-muted-foreground">
          {games.length === 0
            ? `Nenhuma sessão ${period}.`
            : `Quando ${person ?? "você"} jogou cada um dos ${plural(games.length, "jogo", "jogos")} ${period}. Mais de ${timeline.pauseDays} dias sem jogar viram uma pausa.`}
        </p>

        {games.length > 0 && (
          // select-none e sem callout: segurar o dedo numa barra não seleciona o texto.
          <div
            aria-hidden
            className="space-y-2 select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none]"
          >
            <div className="grid grid-cols-1 sm:grid-cols-[15rem_1fr] sm:gap-3">
              <span className="max-sm:hidden" />
              <div className="relative h-4 text-xs leading-none text-muted-foreground">
                {/* Perto da borda direita o rótulo não cabe. */}
                {months
                  .filter((month) => at(month) <= 94)
                  .map((month, i) => (
                    <span
                      key={month}
                      className={cn(
                        "absolute whitespace-nowrap",
                        // No celular, um mês sim e outro não.
                        i % 2 === 1 && "max-sm:hidden",
                      )}
                      style={{ left: `${at(month)}%` }}
                    >
                      {monthShort.format(new Date(`${month}T00:00:00Z`)).replace(".", "")}
                    </span>
                  ))}
              </div>
            </div>

            <ol className="space-y-2 sm:space-y-1">
              {rows.map((game) => (
                <li
                  key={game.gameId}
                  className="grid grid-cols-1 sm:grid-cols-[15rem_1fr] sm:items-center sm:gap-3"
                >
                  <Link
                    to="/jogo/$igdbId"
                    params={{ igdbId: game.igdbId }}
                    tabIndex={-1}
                    className="-mx-1 flex min-w-0 items-baseline justify-between gap-2 px-1 text-sm hover:bg-accent"
                  >
                    <span className="truncate">{game.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {game.minutes > 0 ? formatMinutes(game.minutes) : "—"}
                    </span>
                  </Link>
                  {track(game)}
                </li>
              ))}
            </ol>
          </div>
        )}

        {games.length > ROWS_SHOWN && (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll ? "Ver menos" : `Ver todos os ${games.length} jogos`}
          </Button>
        )}

        {games.length > 0 && <TimelineLegend pauseDays={timeline.pauseDays} />}

        {tooltip.tooltip((mark) => (
          <ChartTooltipBox {...markTooltip(mark)} />
        ))}

        {/* sr-only numa div: em <table> a altura de 1px e o overflow não valem. */}
        <div className="sr-only">
          <table>
            <caption>Linha do tempo {period}</caption>
            <tbody>
              {games.map((game) => (
                <tr key={game.gameId}>
                  <th scope="row">
                    <Link to="/jogo/$igdbId" params={{ igdbId: game.igdbId }}>
                      {game.name}
                    </Link>
                  </th>
                  <td>
                    {game.spans
                      .map(
                        (span) =>
                          `${formatDate(span.from)} a ${formatDate(span.to)} (${formatMinutes(span.minutes)})`,
                      )
                      .join("; ")}
                  </td>
                  <td>
                    {game.completions
                      .map(
                        (c) =>
                          `Zerou (${completionTypeLabels[c.type]}) em ${formatDate(c.completedOn)}`,
                      )
                      .join("; ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

function markTooltip(mark: Mark): { value: string; label: string } {
  const { name } = mark.game;
  if (mark.kind === "completion") {
    const { type, completedOn } = mark.completion;
    return {
      value: `Zerou: ${completionTypeLabels[type]}`,
      label: `${name} · ${formatDate(completedOn)}`,
    };
  }
  if (mark.kind === "pause") {
    const { days, lastPlayedOn, resumedOn } = mark.pause;
    return {
      value: `Pausa de ${plural(days, "dia", "dias")}`,
      label: `${name} · ${formatDate(addDays(lastPlayedOn, 1))} a ${formatDate(addDays(resumedOn, -1))}`,
    };
  }
  const { span } = mark;
  const edges = [span.startedBefore && "já vinha de antes", span.continuesAfter && "seguiu depois"]
    .filter(Boolean)
    .join(", ");
  return {
    value: `${formatMinutes(span.minutes)} em ${plural(span.playedDays, "dia", "dias")}`,
    label: `${name} · ${formatDate(span.from)} a ${formatDate(span.to)}${edges ? ` (${edges})` : ""}`,
  };
}

function TimelineLegend({ pauseDays }: { pauseDays: number }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-4 bg-chart-2" />
        Jogando
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="w-4 border-t-(length:--rule) border-dashed border-muted-foreground/60"
        />
        Mais de {pauseDays} dias sem jogar
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="mx-0.5 size-2.5 rotate-45 bg-primary" />
        Zerou
      </li>
    </ul>
  );
}

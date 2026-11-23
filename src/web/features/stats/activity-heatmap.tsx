import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { addDays, diffInDays, startOfWeek } from "@shared/dates";
import type { Heatmap } from "@shared/stats";
import { Card } from "@/components/ui/card";
import { ChartTooltipBox } from "@/components/ui/chart";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type HeatLevel, heatColors, heatLevel, heatThresholds } from "./heat-levels";

// Heatmap estilo GitHub: uma coluna por semana (segunda a domingo), uma célula por dia.
// No celular a grade rola de lado e começa mostrando as semanas mais recentes.
// Com mouse o dia aparece no hover; no toque, tocar num dia fixa o balão até o próximo toque
// (em outro dia troca, no mesmo dia ou fora da grade fecha), como um menu.

const WEEKDAY_LABELS = [
  ["mon", "seg"],
  ["tue", ""],
  ["wed", "qua"],
  ["thu", ""],
  ["fri", "sex"],
  ["sat", ""],
  ["sun", "dom"],
] as const;

const monthFormat = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("pt-BR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

interface HeatCell {
  date: string;
  minutes: number;
  level: HeatLevel;
  /** Dentro do período e não no futuro. */
  visible: boolean;
}

function buildWeeks(heatmap: Heatmap): HeatCell[][] {
  const byDate = new Map(heatmap.days.map((d) => [d.date, d.minutes]));
  const start = startOfWeek(heatmap.from);
  const count = Math.ceil((diffInDays(start, heatmap.to) + 1) / 7);
  return Array.from({ length: count }, (_w, week) =>
    Array.from({ length: 7 }, (_d, weekday) => {
      const date = addDays(start, week * 7 + weekday);
      const minutes = byDate.get(date) ?? 0;
      return {
        date,
        minutes,
        level: heatLevel(minutes, heatmap.streakMinMinutes),
        visible: date >= heatmap.from && date <= heatmap.to && date <= heatmap.today,
      };
    }),
  );
}

/** Nome do mês na coluna da semana em que ele começa (e no começo, se couber). */
function monthLabels(
  weeks: HeatCell[][],
  from: string,
  to: string,
): { column: number; label: string }[] {
  const labels: { column: number; label: string }[] = [];
  weeks.forEach((week, column) => {
    const first = week.find(
      (cell) => cell.date >= from && cell.date <= to && cell.date.endsWith("-01"),
    );
    if (first) labels.push({ column, label: monthFormat.format(utc(first.date)).replace(".", "") });
  });
  // Período que não começa no dia 1: rotula a primeira coluna se o próximo mês estiver longe.
  if (!from.endsWith("-01") && (labels[0]?.column ?? Infinity) >= 3) {
    labels.unshift({ column: 0, label: monthFormat.format(utc(from)).replace(".", "") });
  }
  return labels;
}

interface ActiveCell {
  cell: HeatCell;
  /** Centro do topo da célula, na viewport. */
  x: number;
  y: number;
  /** Fixado pelo toque: fica até o próximo toque. Sem isso, é hover do mouse. */
  pinned: boolean;
}

interface ActivityHeatmapProps {
  heatmap: Heatmap;
  /** Controles no cabeçalho (ex.: seletor de ano). */
  actions?: ReactNode;
  /** Recarregando outro período: mantém o desenho anterior, apagado. */
  stale?: boolean;
}

export function ActivityHeatmap({ heatmap, actions, stale = false }: ActivityHeatmapProps) {
  const weeks = buildWeeks(heatmap);
  const months = monthLabels(weeks, heatmap.from, heatmap.to);
  const [active, setActive] = useState<ActiveCell | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const period = heatmap.year ? `em ${heatmap.year}` : "nos últimos 12 meses";

  // Quando a grade não cabe, começa mostrando hoje na borda direita (ou o fim de um ano que
  // já passou). Para outro período, quem usa troca a `key` e o componente remonta.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const today = el.querySelector<HTMLElement>("[data-today]");
    el.scrollLeft = today
      ? today.offsetLeft + today.offsetWidth + 8 - el.clientWidth
      : el.scrollWidth;
  }, []);

  // O balão é `fixed`: qualquer rolagem (da grade ou da página) o descola do dia, então fecha.
  // Fixado pelo toque, também fecha com um toque fora da grade ou com Esc.
  const pinned = active?.pinned ?? false;
  useEffect(() => {
    if (!active) return;
    const close = () => setActive(null);
    const onPointerDown = (event: PointerEvent) => {
      // Tocar num dia é tratado no pointerup dele (troca ou fecha); qualquer outro lugar fecha.
      if (!(event.target as Element).closest?.("[data-day]")) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("scroll", close, { capture: true, passive: true });
    if (pinned) {
      document.addEventListener("pointerdown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
    }
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [active, pinned]);

  // Centralizado no dia, mas sem passar da borda da tela (os últimos dias ficam no canto direito).
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el || !active) return;
    const margin = 8;
    const half = el.offsetWidth / 2;
    const max = document.documentElement.clientWidth - margin - half;
    el.style.left = `${Math.max(margin + half, Math.min(active.x, max))}px`;
  }, [active]);

  const show = (target: HTMLElement, cell: HeatCell, isPinned: boolean) => {
    const rect = target.getBoundingClientRect();
    setActive({ cell, x: rect.left + rect.width / 2, y: rect.top, pinned: isPinned });
  };

  return (
    <Card className={cn("gap-3", stale && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="display-xs text-muted-foreground">Atividade</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {heatmap.playedDays > 0
              ? `${formatMinutes(heatmap.totalMinutes)} em ${heatmap.playedDays} ${heatmap.playedDays === 1 ? "dia" : "dias"} ${period}`
              : `Nenhuma sessão ${period}`}
          </p>
        </div>
        {actions}
      </div>

      {/* select-none e sem callout: segurar o dedo no celular selecionava a grade como texto. */}
      <div className="flex gap-2 [--cell:12px] select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] lg:[--cell:17px]">
        <div
          aria-hidden
          className="grid shrink-0 grid-rows-[1.25rem_repeat(7,var(--cell))] gap-0.5 text-xs leading-none text-muted-foreground"
        >
          <span />
          {WEEKDAY_LABELS.map(([key, label]) => (
            <span key={key} className="flex items-center">
              {label}
            </span>
          ))}
        </div>

        <div ref={scrollRef} className="relative min-w-0 overflow-x-auto pb-2">
          {/* Só visual: leitores de tela recebem o resumo acima e a tabela abaixo. */}
          <div
            aria-hidden
            className="grid w-max gap-0.5"
            style={{
              gridTemplateColumns: `repeat(${weeks.length}, var(--cell))`,
              gridTemplateRows: "1.25rem repeat(7, var(--cell))",
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") setActive((prev) => (prev?.pinned ? prev : null));
            }}
          >
            {months.map(({ column, label }) => (
              <span
                key={`${column}-${label}`}
                aria-hidden
                className="text-xs leading-none whitespace-nowrap text-muted-foreground"
                style={{ gridRow: 1, gridColumn: `${column + 1} / span 3` }}
              >
                {label}
              </span>
            ))}
            {weeks.flatMap((week, column) =>
              week.map((cell, weekday) => (
                <span
                  key={cell.date}
                  data-today={cell.date === heatmap.today || undefined}
                  data-day={cell.visible || undefined}
                  style={{
                    gridRow: weekday + 2,
                    gridColumn: column + 1,
                    background: cell.visible ? heatColors[cell.level] : undefined,
                  }}
                  className={cn(
                    "size-(--cell)",
                    cell.visible && "hover:brightness-125",
                    cell.date === heatmap.today && "shadow-[inset_0_0_0_2px_var(--foreground)]",
                    active?.pinned &&
                      active.cell.date === cell.date &&
                      "brightness-125 outline-2 outline-offset-1 outline-foreground",
                  )}
                  onPointerEnter={
                    cell.visible
                      ? (event) => {
                          // No toque o pointerenter vem junto do tap; quem decide é o pointerup.
                          if (event.pointerType !== "mouse" || active?.pinned) return;
                          show(event.currentTarget, cell, false);
                        }
                      : undefined
                  }
                  onPointerUp={
                    cell.visible
                      ? (event) => {
                          // Com mouse o hover já basta. No toque, arrastar para rolar a grade vira
                          // pointercancel, então só um tap de verdade chega aqui.
                          if (event.pointerType === "mouse") return;
                          if (active?.pinned && active.cell.date === cell.date) setActive(null);
                          else show(event.currentTarget, cell, true);
                        }
                      : undefined
                  }
                />
              )),
            )}
          </div>
        </div>
      </div>

      <HeatLegend streakMinMinutes={heatmap.streakMinMinutes} />

      {active && (
        <div
          ref={tooltipRef}
          role="tooltip"
          className="pointer-events-none fixed z-50 w-max -translate-x-1/2 -translate-y-full pb-1"
          style={{ left: active.x, top: active.y }}
        >
          <ChartTooltipBox
            value={active.cell.minutes > 0 ? formatMinutes(active.cell.minutes) : "Não jogou"}
            label={dayFormat.format(utc(active.cell.date))}
          />
        </div>
      )}

      {/* sr-only numa div: em <table> a altura de 1px e o overflow não valem. */}
      <div className="sr-only">
        <table>
          <caption>Dias jogados {period}</caption>
          <tbody>
            {heatmap.days.map((day) => (
              <tr key={day.date}>
                <th scope="row">{dayFormat.format(utc(day.date))}</th>
                <td>{formatMinutes(day.minutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Legenda com o significado de cada degrau (o primeiro corte é o mínimo da ofensiva). */
function HeatLegend({ streakMinMinutes }: { streakMinMinutes: number }) {
  const [counts, more, most] = heatThresholds(streakMinMinutes);
  const items: [HeatLevel, string][] = [
    [0, "Não jogou"],
    [1, `Menos de ${formatMinutes(counts)}`],
    [2, `${formatMinutes(counts)} a ${formatMinutes(more)}`],
    [3, `${formatMinutes(more)} a ${formatMinutes(most)}`],
    [4, `${formatMinutes(most)} ou mais`],
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map(([level, label]) => (
        <li key={level} className="flex items-center gap-1.5">
          <span aria-hidden className="size-3" style={{ background: heatColors[level] }} />
          {label}
        </li>
      ))}
    </ul>
  );
}

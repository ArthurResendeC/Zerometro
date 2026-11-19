import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { WeekStats } from "@shared/stats";
import { Card } from "@/components/ui/card";
import { ChartContainer, ChartTooltipBox, hourTicks } from "@/components/ui/chart";
import { formatMinutes } from "@/lib/format";

const weekLabel = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

const formatWeek = (weekStart: string) => weekLabel.format(new Date(`${weekStart}T00:00:00Z`));

interface WeekDatum extends WeekStats {
  label: string;
  current: boolean;
}

function WeekTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const week = payload?.[0]?.payload as WeekDatum | undefined;
  if (!active || !week) return null;
  return (
    <ChartTooltipBox
      value={formatMinutes(week.minutes)}
      label={week.current ? "Esta semana" : `Semana de ${week.label}`}
    />
  );
}

/** Horas por semana nas últimas 8 semanas; a semana atual em destaque (laranja). */
export function WeeksChart({ weeks }: { weeks: WeekStats[] }) {
  const data: WeekDatum[] = weeks.map((week, i) => ({
    ...week,
    label: formatWeek(week.weekStart),
    current: i === weeks.length - 1,
  }));
  const ticks = hourTicks(Math.max(...weeks.map((w) => w.minutes), 0));

  return (
    <Card className="gap-3">
      <p className="display-xs text-muted-foreground">Últimas 8 semanas</p>
      <ChartContainer className="h-40">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: "var(--border)", strokeWidth: 2 }}
            interval="preserveStartEnd"
            minTickGap={8}
          />
          <YAxis
            ticks={ticks}
            domain={[0, ticks.at(-1) ?? 60]}
            tickFormatter={(minutes: number) => `${minutes / 60}h`}
            interval={0}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            isAnimationActive={false}
            content={WeekTooltip}
          />
          <Bar dataKey="minutes" maxBarSize={24} isAnimationActive={false}>
            {data.map((week) => (
              <Cell
                key={week.weekStart}
                fill={week.current ? "var(--primary)" : "var(--chart-2)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      {/* Tabela para leitores de tela: os valores não dependem do hover. */}
      <table className="sr-only">
        <caption>Minutos jogados por semana</caption>
        <tbody>
          {data.map((week) => (
            <tr key={week.weekStart}>
              <th scope="row">Semana de {week.label}</th>
              <td>{formatMinutes(week.minutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

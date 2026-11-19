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
import { ChartContainer, ChartTooltipBox, hourTicks } from "@/components/ui/chart";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";

// Gráfico de colunas de uma série só (Recharts): barras finas, eixo em horas ou em
// quantidade, tooltip por coluna e uma tabela para leitores de tela.

export interface Column {
  key: string;
  /** Rótulo curto do eixo X. */
  label: string;
  value: number;
  /** Rótulo completo, no tooltip e na tabela (ex.: "Semana de 16/11"). */
  title: string;
  /** Destaque (ex.: a semana atual), em laranja. */
  highlight?: boolean;
}

export type ColumnUnit = "minutes" | "sessions";

interface ColumnChartProps {
  data: Column[];
  unit?: ColumnUnit;
  /** Descrição da tabela para leitores de tela. */
  caption: string;
  className?: string;
}

export function formatColumnValue(value: number, unit: ColumnUnit): string {
  return unit === "minutes"
    ? formatMinutes(value)
    : `${value} ${value === 1 ? "sessão" : "sessões"}`;
}

/** Marcas inteiras para contagens: 0, 1, 2… ou 0, 5, 10… (até ~4 divisões). */
function countTicks(max: number): number[] {
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((s) => max / s <= 4) ?? 1000;
  return Array.from({ length: Math.max(1, Math.ceil(max / step)) + 1 }, (_, i) => i * step);
}

function ColumnTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const column = payload?.[0]?.payload as (Column & { unit: ColumnUnit }) | undefined;
  if (!active || !column) return null;
  return (
    <ChartTooltipBox value={formatColumnValue(column.value, column.unit)} label={column.title} />
  );
}

export function ColumnChart({ data, unit = "minutes", caption, className }: ColumnChartProps) {
  const max = Math.max(...data.map((d) => d.value), 0);
  const ticks = unit === "minutes" ? hourTicks(max) : countTicks(max);
  const rows = data.map((d) => ({ ...d, unit }));

  return (
    <>
      <ChartContainer className={cn("h-40", className)}>
        <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
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
            domain={[0, ticks.at(-1) ?? 1]}
            tickFormatter={(value: number) => (unit === "minutes" ? `${value / 60}h` : `${value}`)}
            interval={0}
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            isAnimationActive={false}
            content={ColumnTooltip}
          />
          <Bar dataKey="value" maxBarSize={24} isAnimationActive={false}>
            {rows.map((d) => (
              <Cell key={d.key} fill={d.highlight ? "var(--primary)" : "var(--chart-2)"} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      {/* Os valores não dependem do hover. */}
      {/* sr-only numa div: em <table> a altura de 1px e o overflow não valem. */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <th scope="row">{d.title}</th>
                <td>{formatColumnValue(d.value, unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

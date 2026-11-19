import type { ReactElement, ReactNode } from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

// Base dos gráficos (Recharts), no espírito do chart do shadcn: o container dá tamanho e o
// visual dos eixos/grade; o tooltip segue o estilo pixel do app. Cores sempre por token
// (var(--chart-*), var(--primary)), para claro e escuro saírem do mesmo código.

interface ChartContainerProps {
  /** Altura da área do gráfico, eixo X incluso (ex.: "h-40"). */
  className?: string;
  /** Um gráfico do Recharts (BarChart, AreaChart…). */
  children: ReactElement;
}

export function ChartContainer({ className, children }: ChartContainerProps) {
  return (
    <div
      data-slot="chart"
      className={cn(
        "w-full text-xs tabular-nums",
        // Eixos e grade recessivos: texto apagado, linhas finas e contínuas.
        "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground",
        "[&_.recharts-cartesian-grid_line]:stroke-muted",
        "[&_.recharts-surface]:outline-none [&_.recharts-wrapper]:outline-none",
        className,
      )}
    >
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 1 }}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

interface ChartTooltipBoxProps {
  /** O valor vem primeiro e em destaque; o rótulo (ex.: a semana) fica secundário. */
  value: ReactNode;
  label: ReactNode;
}

export function ChartTooltipBox({ value, label }: ChartTooltipBoxProps) {
  return (
    <div className="m-0.5 space-y-0.5 bg-card px-2 py-1.5 pixel-frame-thin">
      <p className="text-sm text-foreground tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/** Marcas "redondas" em horas para um eixo em minutos: 0, 2h, 4h… (até ~4 divisões). */
export function hourTicks(maxMinutes: number): number[] {
  const maxHours = Math.max(1, maxMinutes / 60);
  const step = [1, 2, 5, 10, 20, 50, 100].find((s) => maxHours / s <= 4) ?? 200;
  const count = Math.ceil(maxHours / step);
  return Array.from({ length: count + 1 }, (_, i) => i * step * 60);
}

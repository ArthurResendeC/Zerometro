import type { WeekStats } from "@shared/stats";
import { Card } from "@/components/ui/card";
import { ColumnChart } from "./column-chart";

const weekLabel = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

/** Horas por semana nas últimas 8 semanas; a semana atual em destaque (laranja). */
export function WeeksChart({ weeks }: { weeks: WeekStats[] }) {
  return (
    <Card className="gap-3">
      <p className="display-xs text-muted-foreground">Últimas 8 semanas</p>
      <ColumnChart
        caption="Minutos jogados por semana"
        data={weeks.map((week, i) => {
          const label = weekLabel.format(new Date(`${week.weekStart}T00:00:00Z`));
          const current = i === weeks.length - 1;
          return {
            key: week.weekStart,
            label,
            value: week.minutes,
            title: current ? "Esta semana" : `Semana de ${label}`,
            highlight: current,
          };
        })}
      />
    </Card>
  );
}

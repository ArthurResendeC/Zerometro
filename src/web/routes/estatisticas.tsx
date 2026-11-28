import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { ActivityHeatmap } from "@/features/stats/activity-heatmap";
import { GamesCard, GenresCard } from "@/features/stats/breakdown-cards";
import { RecordsSection } from "@/features/stats/records-section";
import { PurchasesSection } from "@/features/stats/purchases-section";
import { RhythmSection } from "@/features/stats/rhythm-section";
import { TimelineSection } from "@/features/stats/timeline-section";
import {
  breakdownQuery,
  heatmapQuery,
  purchasesQuery,
  recordsQuery,
  rhythmQuery,
  timelineQuery,
} from "@/lib/queries";

const searchSchema = z.object({
  /** Ano de calendário; sem ano, os últimos 12 meses. */
  ano: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
});

export const Route = createFileRoute("/estatisticas")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ year: search.ano }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(heatmapQuery(deps.year)),
      context.queryClient.ensureQueryData(breakdownQuery(deps.year)),
      context.queryClient.ensureQueryData(rhythmQuery(deps.year)),
      context.queryClient.ensureQueryData(recordsQuery(deps.year)),
      context.queryClient.ensureQueryData(timelineQuery(deps.year)),
      context.queryClient.ensureQueryData(purchasesQuery(deps.year)),
    ]),
  component: StatsPage,
});

function StatsPage() {
  const { ano: year } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: heatmap } = useSuspenseQuery(heatmapQuery(year));
  const { data: breakdown } = useSuspenseQuery(breakdownQuery(year));
  const { data: rhythm } = useSuspenseQuery(rhythmQuery(year));
  const { data: records } = useSuspenseQuery(recordsQuery(year));
  const { data: timeline } = useSuspenseQuery(timelineQuery(year));
  const { data: purchases } = useSuspenseQuery(purchasesQuery(year));
  const period = year ? `em ${year}` : "nos últimos 12 meses";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display-lg">Estatísticas</h1>
        <p className="mt-2 text-muted-foreground">O que e quanto você jogou {period}.</p>
      </div>

      {/* O m-1 do Card anularia a margem do space-y: a div leva a margem. */}
      <div>
        <RecapCard />
      </div>

      {/* Filtro acima de tudo o que ele recorta. */}
      <NativeSelect
        aria-label="Período"
        value={year ?? ""}
        onChange={(e) =>
          navigate({ search: { ano: e.target.value ? Number(e.target.value) : undefined } })
        }
        className="w-52"
      >
        <option value="">Últimos 12 meses</option>
        {heatmap.years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </NativeSelect>

      <ActivityHeatmap key={year ?? "rolling"} heatmap={heatmap} />

      <div className="grid grid-cols-1 gap-x-4 gap-y-6 lg:grid-cols-2">
        <GenresCard breakdown={breakdown} />
        <GamesCard breakdown={breakdown} />
      </div>

      <TimelineSection timeline={timeline} />

      <RhythmSection rhythm={rhythm} />

      <RecordsSection records={records} />

      <PurchasesSection purchases={purchases} />
    </div>
  );
}

/** Atalho para o recap em slides do último período fechado. */
function RecapCard() {
  return (
    <Card className="flex-row flex-wrap items-center justify-between gap-4">
      <div>
        <h2 className="display-xs text-muted-foreground">Recap</h2>
        <p className="mt-1">Seus jogos, gêneros e destaques em slides, estilo retrospectiva.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button asChild size="sm">
          <Link to="/recap" search={{ periodo: "semana" }}>
            Semana passada
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to="/recap" search={{ periodo: "mes" }}>
            Mês passado
          </Link>
        </Button>
      </div>
    </Card>
  );
}

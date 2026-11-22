import { useEffect, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { isoDateSchema } from "@shared/dates";
import type { RecapPeriod } from "@shared/recap";
import { ArrowLeftIcon, ArrowRightIcon, CloseIcon, UploadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { RecapStory } from "@/features/recap/recap-story";
import { ShareRecapDialog } from "@/features/recap/share-recap-dialog";
import { periodLabel } from "@shared/recap-text";
import { recapQuery } from "@/lib/queries";

/** Período na URL, em português (como os outros filtros). */
const periodParams = { semana: "week", mes: "month" } as const satisfies Record<
  string,
  RecapPeriod
>;
type PeriodParam = keyof typeof periodParams;

const searchSchema = z.object({
  /** Sem período, a semana. */
  periodo: z.enum(["semana", "mes"]).optional().catch(undefined),
  /** Qualquer dia do período; sem data, a semana passada ou o mês passado. */
  data: isoDateSchema.optional().catch(undefined),
});

export const Route = createFileRoute("/recap")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    period: periodParams[search.periodo ?? "semana"],
    date: search.data,
  }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(recapQuery(deps.period, deps.date)),
  component: RecapPage,
});

/** Tela cheia por cima do app, como os stories: a moldura usa toda a altura que sobra. */
function RecapPage() {
  const search = Route.useSearch();
  const periodo = search.periodo ?? "semana";
  const { data: recap } = useSuspenseQuery(recapQuery(periodParams[periodo], search.data));
  const navigate = Route.useNavigate();
  const goTo = (date: string | null) => date && navigate({ search: { periodo, data: date } });
  const [sharing, setSharing] = useState(false);
  useCloseOnEscape();

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="mx-auto w-full max-w-xl px-4 pt-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="display-sm">Recap</h1>
          <fieldset className="flex gap-3">
            <legend className="sr-only">Período</legend>
            {(Object.keys(periodParams) as PeriodParam[]).map((param) => (
              <Button
                key={param}
                size="sm"
                variant={param === periodo ? "default" : "outline"}
                aria-pressed={param === periodo}
                onClick={() => navigate({ search: { periodo: param } })}
              >
                {param === "semana" ? "Semana" : "Mês"}
              </Button>
            ))}
          </fieldset>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Compartilhar como imagem"
              onClick={() => setSharing(true)}
            >
              <UploadIcon />
            </Button>
            <Button asChild variant="ghost" size="icon" aria-label="Fechar o recap">
              <Link to="/estatisticas">
                <CloseIcon />
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-1 flex items-center justify-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={periodo === "semana" ? "Semana anterior" : "Mês anterior"}
            disabled={!recap.previous}
            onClick={() => goTo(recap.previous)}
          >
            <ArrowLeftIcon />
          </Button>
          <p className="min-w-0 text-center text-lg" aria-live="polite">
            {periodLabel(recap.period, recap.from, recap.to)}
            {recap.inProgress && <span className="text-muted-foreground"> (em andamento)</span>}
          </p>
          <Button
            variant="ghost"
            size="icon"
            aria-label={periodo === "semana" ? "Próxima semana" : "Próximo mês"}
            disabled={!recap.next}
            onClick={() => goTo(recap.next)}
          >
            <ArrowRightIcon />
          </Button>
        </div>
      </header>

      <RecapStory key={`${recap.period}-${recap.from}`} recap={recap} />
      <ShareRecapDialog recap={recap} open={sharing} onOpenChange={setSharing} />
    </div>
  );
}

/** Esc fecha o recap e volta para as estatísticas. */
function useCloseOnEscape() {
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Com um diálogo aberto, o Esc é dele (fecha o diálogo, não o recap).
      if (event.key === "Escape" && !document.querySelector('[role="dialog"]')) {
        void navigate({ to: "/estatisticas" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}

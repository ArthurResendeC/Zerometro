import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { gameStatuses, gameStatusLabels, gameStatusSchema } from "@shared/domain";
import { GameCard, GameGrid } from "@/components/game-card";
import { SearchInput } from "@/components/search-input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { libraryListQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

// Filtros na URL: dá para favoritar/compartilhar e o "voltar" do navegador funciona.
const searchSchema = z.object({
  status: gameStatusSchema.optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
});

export const Route = createFileRoute("/biblioteca")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(libraryListQuery(deps)),
  component: LibraryPage,
});

function LibraryPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data, isFetching } = useQuery(libraryListQuery(search));

  const total = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;
  const tabs = [
    { status: undefined, label: "Todos", count: total },
    ...gameStatuses.map((status) => ({
      status,
      label: gameStatusLabels[status],
      count: data?.counts[status] ?? 0,
    })),
  ];

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="display-lg">Biblioteca</h1>
        <SearchInput
          value={search.q ?? ""}
          onChange={(q) =>
            navigate({ search: (prev) => ({ ...prev, q: q || undefined }), replace: true })
          }
          placeholder="Filtrar por nome"
          className="w-full sm:w-64"
        />
      </div>

      <nav
        aria-label="Status"
        className="-mx-4 flex overflow-x-auto border-b-4 border-border px-4 pt-1"
      >
        {tabs.map((tab) => {
          const active = search.status === tab.status;
          return (
            <Link
              key={tab.label}
              to="/biblioteca"
              search={(prev) => ({ ...prev, status: tab.status })}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex shrink-0 items-center gap-2 px-4 pt-3.5 pb-3 display-xs",
                active
                  ? "mx-1 bg-card text-foreground shadow-[0_-4px_0_0_var(--border),-4px_0_0_0_var(--border),4px_0_0_0_var(--border),0_4px_0_0_var(--card)] after:absolute after:inset-x-0 after:top-0 after:h-1 after:bg-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {tab.label}
              <span className="font-sans text-xs text-muted-foreground normal-case">
                {tab.count}
              </span>
            </Link>
          );
        })}
      </nav>

      {!data ? (
        <GridSkeleton />
      ) : data.items.length === 0 ? (
        <EmptyState filtered={Boolean(search.q || search.status)} />
      ) : (
        <div className={cn(isFetching && "opacity-60")}>
          <GameGrid>
            {data.items.map((item) => (
              <GameCard key={item.gameId} item={item} showStatus={!search.status} />
            ))}
          </GameGrid>
        </div>
      )}
    </section>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <Card className="items-start gap-3 p-6">
      <p className="text-muted-foreground">
        {filtered ? "Nenhum jogo com esse filtro." : "Sua biblioteca está vazia."}
      </p>
      <Button asChild>
        <Link to="/adicionar">Adicionar jogo</Link>
      </Button>
    </Card>
  );
}

function GridSkeleton() {
  return (
    <GameGrid>
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="aspect-3/4 w-full" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      ))}
    </GameGrid>
  );
}

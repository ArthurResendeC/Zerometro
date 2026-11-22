import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { gameStatuses, gameStatusLabels, gameStatusSchema } from "@shared/domain";
import {
  type LibrarySort,
  librarySortLabels,
  librarySorts,
  sortDirectionSchema,
  sortLibraryItems,
} from "@shared/library";
import { GameCard, GameGrid } from "@/components/game-card";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from "@/components/icons";
import { SearchInput } from "@/components/search-input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { libraryListQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Critério de ordenação na URL, em português (como o resto dos filtros). */
const sortParams = { ultima: "last_session", inicio: "started_at", nota: "rating" } as const;
type SortParam = keyof typeof sortParams;
const sortParamOf = Object.fromEntries(
  Object.entries(sortParams).map(([param, sort]) => [sort, param]),
) as Record<LibrarySort, SortParam>;
const DEFAULT_SORT: LibrarySort = "last_session";

// Filtros na URL: dá para favoritar/compartilhar e o "voltar" do navegador funciona.
const searchSchema = z.object({
  status: gameStatusSchema.optional().catch(undefined),
  /** Só pós-jogo (dentro de "Jogando"). */
  estado: z.literal("posjogo").optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  /** Ordenação (sem: última sessão). A lista vem inteira; ordenar é no cliente. */
  ordem: z
    .enum(Object.keys(sortParams) as [SortParam, ...SortParam[]])
    .optional()
    .catch(undefined),
  /** Direção (sem: desc, mais recente/maior nota primeiro). */
  dir: sortDirectionSchema.optional().catch(undefined),
});

export const Route = createFileRoute("/biblioteca")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => toListQuery(search),
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(libraryListQuery(deps)),
  component: LibraryPage,
});

/** O filtro de pós-jogo só vale na aba "Jogando". */
function toListQuery({ status, estado, q }: z.infer<typeof searchSchema>) {
  return {
    status,
    q,
    ...(status === "playing" && estado === "posjogo" && { displayState: "postgame" as const }),
  };
}

function LibraryPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data, isFetching } = useQuery(libraryListQuery(toListQuery(search)));
  const postgameOnly = search.status === "playing" && search.estado === "posjogo";
  const sort = search.ordem ? sortParams[search.ordem] : DEFAULT_SORT;
  const direction = search.dir ?? "desc";
  const items = useMemo(
    () => (data ? sortLibraryItems(data.items, sort, direction) : []),
    [data, sort, direction],
  );

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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="display-lg">Biblioteca</h1>
          {/* O cabeçalho do app tem o "Jogar"; adicionar jogos fica aqui, junto da biblioteca. */}
          <Button asChild size="sm" variant="outline">
            <Link to="/adicionar">
              <PlusIcon /> Adicionar jogo
            </Link>
          </Button>
        </div>
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 sm:w-auto">
          <SearchInput
            value={search.q ?? ""}
            onChange={(q) =>
              navigate({ search: (prev) => ({ ...prev, q: q || undefined }), replace: true })
            }
            placeholder="Filtrar por nome"
            className="w-full sm:w-64"
          />
          <div className="flex flex-1 items-center gap-1 sm:flex-none">
            <NativeSelect
              aria-label="Ordenar por"
              value={sort}
              onChange={(e) => {
                const next = e.target.value as LibrarySort;
                navigate({
                  search: (prev) => ({
                    ...prev,
                    ordem: next === DEFAULT_SORT ? undefined : sortParamOf[next],
                  }),
                });
              }}
              className="min-w-0 flex-1 sm:w-48 sm:flex-none"
            >
              {librarySorts.map((option) => (
                <option key={option} value={option}>
                  {librarySortLabels[option]}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="outline"
              size="icon"
              aria-label={
                direction === "desc" ? "Ordem decrescente (inverter)" : "Ordem crescente (inverter)"
              }
              title={direction === "desc" ? "Decrescente" : "Crescente"}
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, dir: direction === "desc" ? "asc" : undefined }),
                })
              }
              className="mb-2 mr-1"
            >
              {direction === "desc" ? <ArrowDownIcon /> : <ArrowUpIcon />}
            </Button>
          </div>
        </div>
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
              search={(prev) => ({ ...prev, status: tab.status, estado: undefined })}
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

      {search.status === "playing" && (data?.postgame ?? 0) > 0 && (
        <div className="flex">
          <Link
            to="/biblioteca"
            search={(prev) => ({ ...prev, estado: postgameOnly ? undefined : "posjogo" })}
            aria-pressed={postgameOnly}
            className={cn(
              "m-0.5 inline-flex items-center gap-2 px-2.5 py-1.5 display-xs pixel-frame-thin",
              postgameOnly
                ? "bg-status-playing text-status-playing-foreground [--px-frame-color:var(--status-playing)]"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            Só pós-jogo
            <span className="font-sans text-xs normal-case">{data?.postgame}</span>
          </Link>
        </div>
      )}

      {!data ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <EmptyState filtered={Boolean(search.q || search.status || postgameOnly)} />
      ) : (
        <div className={cn(isFetching && "opacity-60")}>
          <GameGrid>
            {items.map((item) => (
              <GameCard
                key={item.gameId}
                item={item}
                showStatus={!search.status}
                sortBadge={sort}
              />
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

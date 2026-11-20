import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { genreLabel } from "@shared/genres";
import { igdbIdSchema } from "@shared/igdb";
import { GameCover } from "@/components/game-cover";
import { ArrowLeftIcon } from "@/components/icons";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MySessions } from "@/features/game/my-sessions";
import { ApiError } from "@/lib/api";
import { gamePageQuery, libraryByIgdbQuery } from "@/lib/queries";

// Página do jogo, aberta pelo id do IGDB (na biblioteca ou não). Duas abas: "Sobre" (dados do
// IGDB) e "Minhas sessões" (só para jogos da biblioteca). O cabeçalho é o mesmo nas duas.

const tabs = ["sobre", "sessoes"] as const;
type Tab = (typeof tabs)[number];

const searchSchema = z.object({
  /** Sem aba: "sessoes" se o jogo estiver na biblioteca, senão "sobre". */
  aba: z.enum(tabs).optional().catch(undefined),
});

export const Route = createFileRoute("/jogo/$igdbId")({
  params: {
    parse: (raw) => ({ igdbId: igdbIdSchema.parse(raw.igdbId) }),
    stringify: ({ igdbId }) => ({ igdbId: String(igdbId) }),
  },
  validateSearch: searchSchema,
  loader: ({ context, params }) => {
    // O IGDB começa a carregar junto, mas a página não espera por ele.
    void context.queryClient.prefetchQuery(gamePageQuery(params.igdbId));
    return context.queryClient.ensureQueryData(libraryByIgdbQuery(params.igdbId));
  },
  component: GamePage,
  errorComponent: () => (
    <div className="space-y-4">
      <p className="text-muted-foreground">Não foi possível carregar o jogo.</p>
      <Button asChild variant="outline">
        <Link to="/biblioteca">Voltar para a biblioteca</Link>
      </Button>
    </div>
  ),
});

function GamePage() {
  const { igdbId } = Route.useParams();
  const { aba } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: item } = useSuspenseQuery(libraryByIgdbQuery(igdbId));
  const page = useQuery(gamePageQuery(igdbId));

  const tab: Tab = item ? (aba ?? "sessoes") : "sobre";
  const setTab = (next: Tab) => void navigate({ search: { aba: next }, replace: true });

  // Cabeçalho: o que a biblioteca já sabe; senão, o IGDB.
  const game = item ?? page.data;
  if (!game) return <PageFallback error={page.error} loading={page.isPending} />;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        {item ? (
          <Link to="/biblioteca">
            <ArrowLeftIcon /> Biblioteca
          </Link>
        ) : (
          <Link to="/">
            <ArrowLeftIcon /> Início
          </Link>
        )}
      </Button>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="mx-auto w-44 self-start bg-card p-2.5 pixel-frame md:w-full">
          <GameCover name={game.name} imageId={game.coverImageId} size="720p" />
        </div>

        <div className="space-y-6">
          <header className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-[32px] leading-9">{game.name}</h1>
              {item && <TabToggle tab={tab} onChange={setTab} />}
            </div>
            <p className="text-muted-foreground">
              {[game.releaseYear, ...game.genres.map(genreLabel)].filter(Boolean).join(" · ")}
            </p>
            <div className="flex flex-wrap gap-1">
              {item && <StatusBadge status={item.status} />}
              {game.platforms.map((p) => (
                <Badge key={p} variant="outline">
                  {p}
                </Badge>
              ))}
            </div>
          </header>

          {tab === "sessoes" && item ? <MySessions item={item} /> : <AboutTab igdbId={igdbId} />}
        </div>
      </div>
    </div>
  );
}

const tabLabels: Record<Tab, string> = { sobre: "Sobre o jogo", sessoes: "Minhas sessões" };

function TabToggle({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <fieldset className="flex">
      <legend className="sr-only">Ver</legend>
      {tabs.map((t) => (
        <Button
          key={t}
          size="sm"
          variant={t === tab ? "default" : "outline"}
          aria-pressed={t === tab}
          onClick={() => onChange(t)}
        >
          {tabLabels[t]}
        </Button>
      ))}
    </fieldset>
  );
}

// Provisório: a aba "Sobre" de verdade vem nos próximos passos.
function AboutTab({ igdbId }: { igdbId: number }) {
  const { data: page, isPending, isError } = useQuery(gamePageQuery(igdbId));
  if (isPending) return <Skeleton className="h-24" />;
  if (isError) return <p className="text-muted-foreground">O IGDB não respondeu agora.</p>;
  return (
    <p className="leading-7 whitespace-pre-line">
      {page.summary ?? "O IGDB não tem uma descrição deste jogo."}
    </p>
  );
}

/** Jogo fora da biblioteca enquanto o IGDB carrega, ou quando ele falha. */
function PageFallback({ error, loading }: { error: Error | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid gap-8 md:grid-cols-[220px_minmax(0,1fr)]" aria-busy>
        <Skeleton className="mx-auto aspect-3/4 w-44 md:w-full" />
        <div className="space-y-3">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
        </div>
      </div>
    );
  }
  const message =
    error instanceof ApiError && error.status === 404
      ? "Esse jogo não existe no IGDB."
      : error instanceof ApiError && error.status === 503
        ? "A busca no IGDB não está configurada neste servidor."
        : "O IGDB não respondeu agora. Tente de novo daqui a pouco.";
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">{message}</p>
      <Button asChild variant="outline">
        <Link to="/">Voltar para o início</Link>
      </Button>
    </div>
  );
}

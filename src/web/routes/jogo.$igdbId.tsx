import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { IgdbGamePage } from "@shared/game-page";
import { igdbIdSchema } from "@shared/igdb";
import { AddToLibraryButton, defaultAddStatus } from "@/components/add-to-library-button";
import { ArrowLeftIcon } from "@/components/icons";
import { CompletionBadge, completionAddsInfo, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AboutTab } from "@/features/game/about-tab";
import { AchievementsTab } from "@/features/game/achievements-tab";
import { GameHero, type HeroGame } from "@/features/game/game-hero";
import { LastNoteBlock } from "@/components/last-note";
import { MySessions } from "@/features/game/my-sessions";
import { type GameTab, gameTabs, TabToggle } from "@/features/game/tab-toggle";
import { useNow } from "@/hooks/use-now";
import { ApiError } from "@/lib/api";
import { gamePageQuery, libraryByIgdbQuery } from "@/lib/queries";

// Página do jogo, aberta pelo id do IGDB (na biblioteca ou não). Abas: "Sobre" (dados do IGDB),
// "Minhas sessões" e "Conquistas" (essas duas só para jogos da biblioteca). O cabeçalho é o mesmo.

const searchSchema = z.object({
  /** Sem aba: "sessoes" se o jogo estiver na biblioteca, senão "sobre". */
  aba: z.enum(gameTabs).optional().catch(undefined),
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

  const tab: GameTab = item ? (aba ?? "sessoes") : "sobre";
  const setTab = (next: GameTab) => void navigate({ search: { aba: next }, replace: true });

  // O básico vem da biblioteca (sem esperar o IGDB, sem pulo quando ele chega); o IGDB
  // completa o banner, os estúdios e o selo de status.
  const base = item ?? page.data;
  if (!base) return <PageFallback error={page.error} loading={page.isPending} />;
  const game: HeroGame = {
    name: base.name,
    coverImageId: base.coverImageId,
    releaseYear: base.releaseYear,
    genres: base.genres,
    platforms: base.platforms,
    // undefined = ainda carregando (banner vazio); null = sem artwork (capa desfocada).
    heroImageId: page.isError ? null : page.data?.heroImageId,
    developers: page.data?.developers,
    publishers: page.data?.publishers,
    releaseStatus: page.data?.status,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-2">
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
        {item ? (
          <TabToggle tab={tab} onChange={setTab} />
        ) : (
          page.data && <AddButtons game={page.data} onAdded={setTab} />
        )}
      </div>

      <GameHero
        game={game}
        badges={
          item && (
            <>
              <StatusBadge status={item.displayState} />
              {completionAddsInfo(item.status, item.completion) && item.completion && (
                <CompletionBadge completion={item.completion} />
              )}
            </>
          )
        }
      >
        {item && <LastNoteBlock item={item} />}
      </GameHero>

      {tab === "sessoes" && item ? (
        <MySessions item={item} />
      ) : tab === "conquistas" && item ? (
        <AchievementsTab item={item} />
      ) : (
        <AboutTab igdbId={igdbId} item={item} />
      )}
    </div>
  );
}

/**
 * Jogo fora da biblioteca: já lançado → "Próximos" (ou "Jogando", se já começou);
 * por lançar → "Desejos". Começar a jogar leva para a aba das sessões.
 */
function AddButtons({ game, onAdded }: { game: IgdbGamePage; onAdded: (tab: GameTab) => void }) {
  // Datas do IGDB são em UTC.
  const today = new Date(useNow(60 * 60_000)).toISOString().slice(0, 10);
  const status = defaultAddStatus(game.releaseDate, today);
  return (
    <div className="flex flex-wrap justify-end">
      {status === "backlog" && (
        <AddToLibraryButton game={game} status="playing" onAdded={() => onAdded("sessoes")} />
      )}
      <AddToLibraryButton
        game={game}
        status={status}
        variant="default"
        onAdded={() => onAdded("sobre")}
      />
    </div>
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

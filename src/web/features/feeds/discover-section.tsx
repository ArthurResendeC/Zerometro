import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { GameStatus } from "@shared/domain";
import { type Feed, type FeedGame, type FeedKey, feedTitles } from "@shared/feeds";
import { igdbGameUrl } from "@shared/igdb";
import type { LibraryItem } from "@shared/library";
import { GameCover } from "@/components/game-cover";
import { PlusIcon, StarIcon } from "@/components/icons";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import { formatReleaseDate } from "@/lib/format";
import { feedsQuery, libraryListQuery, useAddToLibrary } from "@/lib/queries";

/**
 * Listas do IGDB no fim da home. Carrega à parte (sem suspense): a home nunca espera o IGDB.
 * Lista vazia some; sem nenhuma lista (IGDB não configurado), a seção inteira some.
 */
export function DiscoverSection() {
  const feeds = useQuery(feedsQuery());
  const library = useQuery(libraryListQuery());
  // Para decidir entre "Próximos" (já lançado) e "Desejos"; datas do IGDB são em UTC.
  const today = new Date(useNow(60 * 60_000)).toISOString().slice(0, 10);

  if (feeds.isError) return null;
  const visible = feeds.data?.filter((feed) => feed.games.length > 0);
  if (visible?.length === 0) return null;

  // igdbId → item da biblioteca, para mostrar o status em vez do botão de adicionar.
  const inLibrary = library.data && new Map(library.data.items.map((i) => [i.igdbId, i]));

  return (
    <section className="space-y-6" aria-labelledby="descobrir">
      <div>
        <h2 id="descobrir" className="display-md">
          Descobrir
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Listas do IGDB, atualizadas uma vez por dia.
        </p>
      </div>
      {visible
        ? visible.map((feed) => (
            <FeedRow key={feed.key} feed={feed} inLibrary={inLibrary} today={today} />
          ))
        : (["top_rated", "trending", "upcoming"] as const).map((key) => (
            <FeedRowSkeleton key={key} title={feedTitles[key]} />
          ))}
    </section>
  );
}

interface FeedRowProps {
  feed: Feed;
  inLibrary?: Map<number, LibraryItem>;
  today: string;
}

function FeedRow({ feed, inLibrary, today }: FeedRowProps) {
  return (
    <div className="space-y-3">
      <h3 className="display-xs text-muted-foreground">{feedTitles[feed.key]}</h3>
      <ol className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-3 sm:gap-4">
        {feed.games.map((game, i) => (
          <FeedGameCard
            key={game.igdbId}
            feedKey={feed.key}
            game={game}
            rank={i + 1}
            libraryItem={inLibrary?.get(game.igdbId)}
            libraryLoaded={Boolean(inLibrary)}
            today={today}
          />
        ))}
      </ol>
    </div>
  );
}

interface FeedGameCardProps {
  feedKey: FeedKey;
  game: FeedGame;
  rank: number;
  libraryItem?: LibraryItem;
  libraryLoaded: boolean;
  today: string;
}

function FeedGameCard({
  feedKey,
  game,
  rank,
  libraryItem,
  libraryLoaded,
  today,
}: FeedGameCardProps) {
  const releaseDate =
    game.releaseDate && formatReleaseDate(game.releaseDate, game.releasePrecision);
  const meta =
    feedKey === "trending"
      ? [game.genres[0], game.releaseYear].filter(Boolean).join(" · ")
      : releaseDate;

  return (
    <li className="flex w-28 shrink-0 snap-start flex-col gap-2 sm:w-36">
      <a
        href={igdbGameUrl(game)}
        target="_blank"
        rel="noreferrer"
        className="group flex flex-col gap-2 focus-visible:outline-none"
        title={`${game.name} no IGDB`}
      >
        <div className="m-1 bg-card p-2 pixel-frame transition-transform ease-[steps(2)] group-hover:-translate-y-1 group-hover:pixel-drop group-focus-visible:-translate-y-1 group-focus-visible:outline-[3px] group-focus-visible:outline-offset-[7px] group-focus-visible:outline-ring group-focus-visible:outline-solid">
          <div className="relative">
            <GameCover name={game.name} imageId={game.coverImageId} />
            <CoverTag feedKey={feedKey} game={game} rank={rank} />
          </div>
        </div>
        <p className="line-clamp-2 min-h-10 leading-5">{game.name}</p>
      </a>
      <p className="truncate text-xs text-muted-foreground">{meta || " "}</p>
      <div className="mt-auto">
        {libraryItem ? (
          <Link to="/jogos/$gameId" params={{ gameId: libraryItem.gameId }}>
            <StatusBadge status={libraryItem.status} />
          </Link>
        ) : (
          libraryLoaded && <QuickAdd game={game} today={today} />
        )}
      </div>
    </li>
  );
}

/** Selo sobre a capa: nota da crítica nos bem avaliados, posição em alta. */
function CoverTag({ feedKey, game, rank }: { feedKey: FeedKey; game: FeedGame; rank: number }) {
  if (feedKey === "top_rated" && game.criticRating !== null) {
    return (
      <Badge
        className="absolute top-1 left-1 tabular-nums"
        title={`Nota da crítica: ${game.criticRating} (${game.criticRatingCount} análises)`}
      >
        <StarIcon /> {game.criticRating}
      </Badge>
    );
  }
  if (feedKey === "trending") {
    return (
      <Badge variant="secondary" className="absolute top-1 left-1 tabular-nums">
        #{rank}
      </Badge>
    );
  }
  return null;
}

/** Já lançado vai para "Próximos"; ainda por lançar, para a lista de desejos. */
function QuickAdd({ game, today }: { game: FeedGame; today: string }) {
  const add = useAddToLibrary();
  const released = game.releaseDate !== null && game.releaseDate <= today;
  const status: GameStatus = released ? "backlog" : "wishlist";

  return (
    <Button
      size="sm"
      variant="outline"
      className="w-[calc(100%-0.5rem)]"
      disabled={add.isPending}
      onClick={() => add.mutate({ igdbId: game.igdbId, status })}
      aria-label={`Adicionar ${game.name} ${released ? "aos próximos" : "aos desejos"}`}
    >
      <PlusIcon /> {released ? "Próximos" : "Desejos"}
    </Button>
  );
}

function FeedRowSkeleton({ title }: { title: string }) {
  return (
    <div className="space-y-3" aria-hidden>
      <p className="display-xs text-muted-foreground">{title}</p>
      <div className="flex gap-3 overflow-hidden sm:gap-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="w-28 shrink-0 space-y-2 sm:w-36">
            <Skeleton className="m-1 aspect-3/4" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

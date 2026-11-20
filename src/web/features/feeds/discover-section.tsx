import { useQuery } from "@tanstack/react-query";
import { type Feed, type FeedGame, type FeedKey, feedTitles } from "@shared/feeds";
import { genreLabel } from "@shared/genres";
import type { LibraryItem } from "@shared/library";
import { GameRow, GameRowCard } from "@/components/game-row";
import { AddToLibraryButton, defaultAddStatus } from "@/components/add-to-library-button";
import { StarIcon } from "@/components/icons";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import { formatReleaseDate } from "@/lib/format";
import { feedsQuery, libraryListQuery } from "@/lib/queries";

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
      <GameRow>
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
      </GameRow>
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
      ? [game.genres[0] && genreLabel(game.genres[0]), game.releaseYear].filter(Boolean).join(" · ")
      : releaseDate;

  return (
    <GameRowCard
      game={game}
      tag={<CoverTag feedKey={feedKey} game={game} rank={rank} />}
      meta={meta || ""}
      footer={
        // Altura do botão: selo e botão ficam alinhados entre os cards.
        <div className="mt-auto flex min-h-11 items-center">
          {libraryItem ? (
            <StatusBadge status={libraryItem.status} />
          ) : (
            libraryLoaded && (
              <AddToLibraryButton
                game={game}
                status={defaultAddStatus(game.releaseDate, today)}
                className="w-[calc(100%-0.5rem)]"
              />
            )
          )}
        </div>
      }
    />
  );
}

/** Selo sobre a capa: nota da crítica nos bem avaliados, posição em alta. */
function CoverTag({ feedKey, game, rank }: { feedKey: FeedKey; game: FeedGame; rank: number }) {
  if (feedKey === "top_rated" && game.criticRating !== null) {
    return (
      <Badge
        className="absolute top-1 left-1 tabular-nums"
        title={`Nota da crítica no IGDB: ${game.criticRating} (média de ${game.criticRatingCount} análises)`}
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

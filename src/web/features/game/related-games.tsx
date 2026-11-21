import { useQuery } from "@tanstack/react-query";
import type { IgdbGamePage, RelatedGame } from "@shared/game-page";
import { GameCarousel, GameCarouselCard } from "@/components/game-row";
import { StatusBadge } from "@/components/status-badge";
import { libraryListQuery } from "@/lib/queries";

// Fileiras de jogos ligados a este: jogo base, expansões, remakes, série e parecidos.
// Cada card abre a página do jogo, então dá para ir de jogo em jogo.

export function RelatedGames({ game }: { game: IgdbGamePage }) {
  const library = useQuery(libraryListQuery());
  const inLibrary = new Map(library.data?.items.map((i) => [i.igdbId, i.status]));
  // Cada jogo só na primeira fileira em que aparece (o jogo base também é da mesma série).
  const seen = new Set<number>();
  const rows = (
    [
      ["Jogo base", game.parentGame ? [game.parentGame] : []],
      ["Expansões e DLCs", [...game.related.expansions, ...game.related.dlcs]],
      ["Remakes e remasters", game.related.remakes],
      ["Da mesma série", game.related.series],
      ["Parecidos", game.related.similar],
    ] satisfies [string, RelatedGame[]][]
  ).map(([title, games]) => {
    const fresh = games.filter((g) => !seen.has(g.igdbId));
    for (const g of fresh) seen.add(g.igdbId);
    return [title, fresh] as const;
  });

  return rows.map(
    ([title, games]) =>
      games.length > 0 && (
        <GameCarousel key={title} title={title} heading="h2">
          {games.map((g) => {
            const status = inLibrary.get(g.igdbId);
            return (
              <GameCarouselCard
                key={g.igdbId}
                game={g}
                meta={g.releaseYear ?? ""}
                footer={status && <StatusBadge status={status} />}
              />
            );
          })}
        </GameCarousel>
      ),
  );
}

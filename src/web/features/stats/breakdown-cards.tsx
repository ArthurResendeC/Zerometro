import { genreLabel } from "@shared/genres";
import type { PeriodBreakdown } from "@shared/stats";
import { GameCover } from "@/components/game-cover";
import { Card } from "@/components/ui/card";
import { BarList } from "./bar-list";

// Gêneros e jogos mais jogados no período: nas Estatísticas e no /amigo.

const GENRES_SHOWN = 8;

export function GenresCard({ breakdown }: { breakdown: PeriodBreakdown }) {
  const shown = breakdown.genres.slice(0, GENRES_SHOWN);
  const hidden = breakdown.genres.length - shown.length;
  return (
    <Card className="gap-4">
      <div>
        <h2 className="display-xs text-muted-foreground">Gêneros mais jogados</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Tempo em jogos de cada gênero. Um jogo com vários gêneros conta em todos eles.
        </p>
      </div>
      {shown.length === 0 ? (
        <EmptyPeriod />
      ) : (
        <>
          <BarList
            items={shown.map((g) => ({
              key: g.genre,
              label: genreLabel(g.genre),
              minutes: g.minutes,
              hint: `${g.games} ${g.games === 1 ? "jogo" : "jogos"}`,
            }))}
          />
          {hidden > 0 && (
            <p className="text-xs text-muted-foreground">
              E mais {hidden} {hidden === 1 ? "gênero" : "gêneros"}.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

export function GamesCard({ breakdown }: { breakdown: PeriodBreakdown }) {
  return (
    <Card className="gap-4">
      <h2 className="display-xs text-muted-foreground">Jogos mais jogados</h2>
      {breakdown.games.length === 0 ? (
        <EmptyPeriod />
      ) : (
        <BarList
          color="var(--primary)"
          items={breakdown.games.map((game) => ({
            key: game.gameId,
            igdbId: game.igdbId,
            label: game.name,
            minutes: game.minutes,
            leading: (
              <GameCover
                name={game.name}
                imageId={game.coverImageId}
                size="thumb"
                className="w-8 shrink-0"
              />
            ),
          }))}
        />
      )}
    </Card>
  );
}

function EmptyPeriod() {
  return <p className="text-sm text-muted-foreground">Nenhuma sessão nesse período.</p>;
}

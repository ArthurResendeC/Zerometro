import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { Stats, StreakStats } from "@shared/stats";
import { GameCard, GameGrid } from "@/components/game-card";
import { GameCover } from "@/components/game-cover";
import { PixelFlame } from "@/components/icons";
import { TimerButton } from "@/components/timer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DiscoverSection } from "@/features/feeds/discover-section";
import { ActivityHeatmap } from "@/features/stats/activity-heatmap";
import { WeeksChart } from "@/features/stats/weeks-chart";
import { formatMinutes } from "@/lib/format";
import { heatmapQuery, libraryListQuery, statsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

const playingQuery = libraryListQuery({ status: "playing" });

export const Route = createFileRoute("/")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(playingQuery),
      context.queryClient.ensureQueryData(statsQuery()),
      context.queryClient.ensureQueryData(heatmapQuery()),
    ]),
  component: Dashboard,
});

function Dashboard() {
  const { data: playing } = useSuspenseQuery(playingQuery);
  const { data: stats } = useSuspenseQuery(statsQuery());
  const { data: heatmap } = useSuspenseQuery(heatmapQuery());

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div>
          <h1 className="display-lg">Início</h1>
          <p className="mt-2 text-muted-foreground">Quanto falta pra zerar?</p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
          <StreakCard streak={stats.streak} />
          <StatCard
            label="Hoje"
            value={formatMinutes(stats.todayMinutes)}
            hint={`Esta semana: ${formatMinutes(stats.thisWeekMinutes)}`}
          />
          <StatCard
            label="Média diária"
            value={formatMinutes(stats.last30Days.perDay)}
            hint={
              stats.last30Days.playedDays > 0
                ? `${formatMinutes(stats.last30Days.perPlayedDay)} nos dias jogados`
                : "Últimos 30 dias"
            }
          />
          <StatCard
            label="Média semanal"
            value={formatMinutes(stats.weeklyAverageMinutes)}
            hint={`Total: ${formatMinutes(stats.totalMinutes)}`}
          />
        </div>
        <WeeksChart weeks={stats.weeks} />
        <ActivityHeatmap heatmap={heatmap} />
      </section>

      <section className="space-y-4">
        <h2 className="display-md">Jogando agora</h2>
        {playing.items.length === 0 ? (
          <Card className="items-start gap-3 p-6">
            <p className="text-muted-foreground">Nenhum jogo em andamento.</p>
            <div className="flex flex-wrap">
              <Button asChild>
                <Link to="/adicionar">Adicionar jogo</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/biblioteca" search={{ status: "backlog" }}>
                  Ver próximos
                </Link>
              </Button>
            </div>
          </Card>
        ) : (
          <GameGrid>
            {playing.items.map((item) => (
              <div key={item.gameId} className="flex flex-col gap-2">
                <GameCard item={item} />
                <TimerButton
                  gameId={item.gameId}
                  size="sm"
                  variant="outline"
                  compact
                  className="mt-auto"
                />
              </div>
            ))}
          </GameGrid>
        )}
      </section>

      {stats.topGames.length > 0 && <TopGames games={stats.topGames} />}

      <DiscoverSection />
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint: ReactNode }) {
  return (
    <Card className="gap-2">
      <p className="display-xs text-muted-foreground">{label}</p>
      <p className="display-md tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

function StreakCard({ streak }: { streak: StreakStats }) {
  const lit = streak.current > 0;
  const status = streak.todayCounts
    ? "Hoje já conta ✓"
    : streak.atRisk
      ? `Jogue mais ${formatMinutes(streak.todayRemainingMinutes)} hoje para manter`
      : `Jogue ${formatMinutes(streak.todayRemainingMinutes)} hoje para começar`;

  return (
    <Card className={cn("gap-2", streak.atRisk && "[--px-frame-color:var(--primary)]")}>
      <p className="display-xs text-muted-foreground">Ofensiva</p>
      <p className="flex items-end gap-3">
        <PixelFlame lit={lit} className="h-8 w-6.5 sm:h-10 sm:w-8" />
        <span className="display-lg tabular-nums sm:display-xl">{streak.current}</span>
        <span className="text-muted-foreground">{streak.current === 1 ? "dia" : "dias"}</span>
      </p>
      <p className={cn("text-xs", streak.atRisk ? "text-primary" : "text-muted-foreground")}>
        {status}
      </p>
      <p className="text-xs text-muted-foreground">
        Recorde: {streak.best} {streak.best === 1 ? "dia" : "dias"} ·{" "}
        <Link
          to="/ajustes"
          className="underline decoration-dotted underline-offset-4 hover:text-foreground"
        >
          mín. {formatMinutes(streak.minMinutes)}/dia
        </Link>
      </p>
    </Card>
  );
}

function TopGames({ games }: { games: Stats["topGames"] }) {
  const max = games[0]?.minutes ?? 1;

  return (
    <section className="space-y-4">
      <h2 className="display-md">Mais jogados nos últimos 30 dias</h2>
      <ol className="space-y-3">
        {games.map((game) => (
          <li key={game.gameId}>
            <Link
              to="/jogos/$gameId"
              params={{ gameId: game.gameId }}
              className="flex items-center gap-4 p-2 hover:bg-accent"
            >
              <GameCover
                name={game.name}
                imageId={game.coverImageId}
                size="thumb"
                className="w-10 shrink-0"
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{game.name}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {formatMinutes(game.minutes)}
                  </span>
                </div>
                <div className="m-0.5 h-3 bg-muted p-0.5" aria-hidden>
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${(game.minutes / max) * 100}%` }}
                  />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

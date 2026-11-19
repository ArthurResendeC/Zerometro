import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Flame } from "lucide-react";
import type { ReactNode } from "react";
import type { Stats, StreakStats, WeekStats } from "@shared/stats";
import { GameCard, GameGrid } from "@/components/game-card";
import { GameCover } from "@/components/game-cover";
import { TimerButton } from "@/components/timer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatMinutes } from "@/lib/format";
import { libraryListQuery, statsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

const playingQuery = libraryListQuery({ status: "playing" });

export const Route = createFileRoute("/")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(playingQuery),
      context.queryClient.ensureQueryData(statsQuery()),
    ]),
  component: Dashboard,
});

function Dashboard() {
  const { data: playing } = useSuspenseQuery(playingQuery);
  const { data: stats } = useSuspenseQuery(statsQuery());

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Início</h1>
          <p className="text-sm text-muted-foreground">Quanto falta pra zerar?</p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Jogando agora</h2>
        {playing.items.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
            <p className="text-muted-foreground">Nenhum jogo em andamento.</p>
            <div className="flex gap-2">
              <Button asChild>
                <Link to="/adicionar">Adicionar jogo</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/biblioteca" search={{ status: "backlog" }}>
                  Ver próximos
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <GameGrid>
            {playing.items.map((item) => (
              <div key={item.gameId} className="flex flex-col gap-2">
                <GameCard item={item} />
                <TimerButton gameId={item.gameId} size="sm" variant="outline" />
              </div>
            ))}
          </GameGrid>
        )}
      </section>

      {stats.topGames.length > 0 && <TopGames games={stats.topGames} />}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint: ReactNode }) {
  return (
    <Card className="gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
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
    <Card className={cn("gap-1", streak.atRisk && "border-brand/50")}>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Flame className={cn("size-3.5", lit && "fill-brand text-brand")} /> Ofensiva
      </p>
      <p className="text-2xl font-semibold tabular-nums">
        {streak.current} {streak.current === 1 ? "dia" : "dias"}
      </p>
      <p className={cn("text-xs", streak.atRisk ? "text-brand" : "text-muted-foreground")}>
        {status}
      </p>
      <p className="text-xs text-muted-foreground">
        Recorde: {streak.best} {streak.best === 1 ? "dia" : "dias"} ·{" "}
        <Link to="/ajustes" className="underline-offset-2 hover:underline">
          mín. {formatMinutes(streak.minMinutes)}/dia
        </Link>
      </p>
    </Card>
  );
}

const weekLabel = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

/** Barras simples das últimas 8 semanas (gráficos completos entram na fase 2). */
function WeeksChart({ weeks }: { weeks: WeekStats[] }) {
  const max = Math.max(...weeks.map((w) => w.minutes), 1);

  return (
    <Card className="gap-3">
      <p className="text-xs text-muted-foreground">Últimas 8 semanas</p>
      <ol className="flex h-28 items-end gap-2">
        {weeks.map((week, i) => {
          const current = i === weeks.length - 1;
          const label = `Semana de ${weekLabel.format(new Date(`${week.weekStart}T00:00:00Z`))}`;
          return (
            <li
              key={week.weekStart}
              className="group relative flex h-full flex-1 flex-col justify-end"
              title={`${label}: ${formatMinutes(week.minutes)}`}
            >
              <span className="sr-only">
                {label}: {formatMinutes(week.minutes)}
              </span>
              <div
                className={cn(
                  "mx-auto min-h-0.5 w-full max-w-12 rounded-sm transition-colors",
                  current
                    ? "bg-brand"
                    : "bg-muted-foreground/40 group-hover:bg-muted-foreground/70",
                )}
                style={{ height: `${(week.minutes / max) * 100}%` }}
              />
            </li>
          );
        })}
      </ol>
      <div className="flex gap-2 text-[10px] text-muted-foreground tabular-nums" aria-hidden>
        {weeks.map((week) => (
          <span key={week.weekStart} className="flex-1 text-center">
            {weekLabel.format(new Date(`${week.weekStart}T00:00:00Z`))}
          </span>
        ))}
      </div>
    </Card>
  );
}

function TopGames({ games }: { games: Stats["topGames"] }) {
  const max = games[0]?.minutes ?? 1;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Mais jogados nos últimos 30 dias</h2>
      <ol className="space-y-3">
        {games.map((game) => (
          <li key={game.gameId}>
            <Link
              to="/jogos/$gameId"
              params={{ gameId: game.gameId }}
              className="flex items-center gap-3 rounded-lg p-1 hover:bg-muted/50"
            >
              <GameCover
                name={game.name}
                imageId={game.coverImageId}
                size="thumb"
                className="w-9 shrink-0 rounded"
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{game.name}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {formatMinutes(game.minutes)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-brand/80"
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

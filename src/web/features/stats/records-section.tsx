import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { FinishedGame, Records } from "@shared/stats";
import { completionTypeLabels } from "@shared/domain";
import { GameCover } from "@/components/game-cover";
import { Card } from "@/components/ui/card";
import { formatDate, formatMinutes } from "@/lib/format";
import { ColumnChart } from "./column-chart";

// Recordes do período, zerados por mês e cada zerado comparado ao tempo da história no IGDB.

const monthShort = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });
const monthLong = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const ratioFormat = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`);

/** 1,18 → "18% a mais que a história no IGDB"; 0,8 → "20% mais rápido que…". */
function paceText(ratio: number): string {
  const diff = Math.round(Math.abs(ratio - 1) * 100);
  if (diff === 0) return "O mesmo tempo da história no IGDB";
  return ratio > 1
    ? `${diff}% a mais que a história no IGDB`
    : `${diff}% mais rápido que a história no IGDB`;
}

export function RecordsSection({ records }: { records: Records }) {
  const { longestSession, bestDay, bestWeek, paceRatio } = records;

  return (
    <section className="space-y-4" aria-labelledby="recordes">
      <h2 id="recordes" className="display-md">
        Recordes e zerados
      </h2>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
        <StatTile
          label="Maior sessão"
          value={longestSession ? formatMinutes(longestSession.minutes) : "—"}
          hint={
            longestSession ? (
              <>
                <Link
                  to="/jogo/$igdbId"
                  params={{ igdbId: longestSession.igdbId }}
                  className="underline decoration-dotted underline-offset-4 hover:text-foreground"
                >
                  {longestSession.name}
                </Link>
                , {formatDate(longestSession.playedOn)}
              </>
            ) : (
              "Nenhuma sessão"
            )
          }
        />
        <StatTile
          label="Dia mais jogado"
          value={bestDay ? formatMinutes(bestDay.minutes) : "—"}
          hint={bestDay ? formatDate(bestDay.date) : "Nenhuma sessão"}
        />
        <StatTile
          label="Semana mais jogada"
          value={bestWeek ? formatMinutes(bestWeek.minutes) : "—"}
          hint={bestWeek ? `Semana de ${formatDate(bestWeek.weekStart)}` : "Nenhuma sessão"}
        />
        <StatTile
          label="Ritmo vs IGDB"
          value={paceRatio === null ? "—" : `${ratioFormat.format(paceRatio)}×`}
          hint={
            paceRatio === null ? "Zere um jogo com tempo da história no IGDB" : paceText(paceRatio)
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-x-4 gap-y-6 lg:grid-cols-2">
        <Card className="gap-3">
          <div>
            <h3 className="display-xs text-muted-foreground">Zerados por mês</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {records.finished.length === 0
                ? "Nenhum jogo zerado nesse período."
                : `${finishedSummaryText(records.finishedSummary)} no período.`}
            </p>
          </div>
          <ColumnChart
            unit="games"
            caption="Jogos zerados por mês"
            data={records.finishedByMonth.map(({ month, count }) => ({
              key: month,
              label: monthShort.format(monthDate(month)).replace(".", ""),
              value: count,
              title: monthLong.format(monthDate(month)),
            }))}
          />
        </Card>

        <Card className="gap-4">
          <div>
            <h3 className="display-xs text-muted-foreground">Zerados</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Seu tempo (contando o de antes do Zerômetro) contra a história no IGDB.
            </p>
          </div>
          {records.finished.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum jogo zerado nesse período.</p>
          ) : (
            <ol className="space-y-2">
              {records.finished.map((game) => (
                <FinishedRow key={game.gameId} game={game} />
              ))}
            </ol>
          )}
        </Card>
      </div>
    </section>
  );
}

function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint: ReactNode }) {
  return (
    <Card className="gap-2">
      <p className="display-xs text-muted-foreground">{label}</p>
      <p className="display-sm whitespace-nowrap sm:display-md">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

/** "3 jogos zerados · 1 replay · 1 no 100%" (só as partes que existem). */
function finishedSummaryText({ games, replays, full }: Records["finishedSummary"]) {
  return [
    `${games} ${games === 1 ? "jogo zerado" : "jogos zerados"}`,
    replays > 0 && `${replays} ${replays === 1 ? "replay" : "replays"}`,
    full > 0 && `${full} no 100%`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function FinishedRow({ game }: { game: FinishedGame }) {
  const ratio = game.storyMinutes ? game.minutesPlayed / game.storyMinutes : null;
  return (
    <li>
      <Link
        to="/jogo/$igdbId"
        params={{ igdbId: game.igdbId }}
        className="-m-1 flex items-center gap-3 p-1 hover:bg-accent"
      >
        <GameCover
          name={game.name}
          imageId={game.coverImageId}
          size="thumb"
          className="w-8 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate">{game.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatDate(game.completedOn)}
            {game.type !== "main" && ` · ${completionTypeLabels[game.type]}`}
            {game.replays > 0 && " · replay"}
            {game.rating !== null && ` · nota ${game.rating}`}
          </p>
        </div>
        <div className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          <p className="text-sm text-foreground">{formatMinutes(game.minutesPlayed)}</p>
          {game.storyMinutes === null ? (
            <p>sem tempo no IGDB</p>
          ) : (
            <p>
              {/* No celular, só a razão: o nome do jogo precisa do espaço. */}
              <span className="max-sm:hidden">IGDB {formatMinutes(game.storyMinutes)} · </span>
              {ratioFormat.format(ratio!)}×<span className="sm:hidden"> o IGDB</span>
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}

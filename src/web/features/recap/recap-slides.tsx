import type { ReactNode } from "react";
import { completionTypeLabels } from "@shared/domain";
import { genreLabel } from "@shared/genres";
import type { Recap } from "@shared/recap";
import { GameCover } from "@/components/game-cover";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  comparison,
  dayLabel,
  periodLabel,
  plural,
  profileFacts,
  profileTitle,
  recapKicker,
} from "@shared/recap-text";
import type { RecapSlideId } from "./recap-text";

// Os slides do recap. Cada um ocupa a moldura 9:16 inteira; a cor de fundo vem de `slideThemes`
// e todo o resto usa `currentColor`, então funciona nos temas claro e escuro.

export const slideThemes: Record<RecapSlideId, string> = {
  intro: "bg-status-playing text-status-playing-foreground",
  games: "bg-status-backlog text-status-backlog-foreground",
  genres: "bg-status-wishlist text-status-wishlist-foreground",
  discoveries: "bg-status-finished text-status-finished-foreground",
  moments: "bg-card text-card-foreground",
  profile: "bg-foreground text-background",
  trophies: "bg-status-paused text-status-paused-foreground",
  summary: "bg-card text-card-foreground",
  empty: "bg-card text-card-foreground",
};

export const slideTitles: Record<RecapSlideId, string> = {
  intro: "Tempo jogado",
  games: "Mais jogados",
  genres: "Gêneros",
  discoveries: "Estreias e retornos",
  moments: "Momentos",
  profile: "Seu perfil",
  trophies: "Troféus",
  summary: "Resumo",
  empty: "Sem sessões",
};

export function RecapSlide({ id, recap }: { id: RecapSlideId; recap: Recap }) {
  switch (id) {
    case "intro":
      return <IntroSlide recap={recap} />;
    case "games":
      return <GamesSlide recap={recap} />;
    case "genres":
      return <GenresSlide recap={recap} />;
    case "discoveries":
      return <DiscoveriesSlide recap={recap} />;
    case "moments":
      return <MomentsSlide recap={recap} />;
    case "profile":
      return <ProfileSlide recap={recap} />;
    case "trophies":
      return <TrophiesSlide recap={recap} />;
    case "summary":
      return <SummarySlide recap={recap} />;
    case "empty":
      return <EmptySlide recap={recap} />;
  }
}

// ---------------------------------------------------------------------------
// Peças

function Kicker({ children }: { children: ReactNode }) {
  return <p className="display-xs opacity-80">{children}</p>;
}

function Title({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("mt-2 display-md", className)}>{children}</h2>;
}

/** "12h 40min" com as horas grandes e os minutos menores (cabe na largura do celular). */
function BigTime({ minutes, className }: { minutes: number; className?: string }) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return (
    <p className={cn("font-pixel leading-none", className)}>
      {h > 0 && <span className="text-[40px]">{h}h</span>}
      {(m > 0 || h === 0) && (
        <span className={h > 0 ? "ml-2 text-[20px]" : "text-[40px]"}>{m}min</span>
      )}
    </p>
  );
}

/** Uma barra horizontal na cor do texto. */
function Bar({ ratio }: { ratio: number }) {
  return (
    <div className="h-2 bg-current/20" aria-hidden>
      <div className="h-full bg-current" style={{ width: `${Math.max(ratio, 0.02) * 100}%` }} />
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <p className="display-xs opacity-80">{label}</p>
      <p className="mt-1.5 display-md">{value}</p>
      {hint && <p className="mt-1 text-sm leading-tight opacity-80">{hint}</p>}
    </div>
  );
}

/** "da semana" / "do mês". */
const ofPeriod = (recap: Recap) => (recap.period === "week" ? "da semana" : "do mês");
/** "nesta semana" / "neste mês". */
const inPeriod = (recap: Recap) => (recap.period === "week" ? "nesta semana" : "neste mês");
const partialNote = (recap: Recap) =>
  recap.period === "week"
    ? "Parcial: a semana ainda não acabou."
    : "Parcial: o mês ainda não acabou.";

// ---------------------------------------------------------------------------
// Slides

const weekdayLetters = ["S", "T", "Q", "Q", "S", "S", "D"];

function IntroSlide({ recap }: { recap: Recap }) {
  const { trend, text } = comparison(recap.period, recap.totalMinutes, recap.previousMinutes);
  const arrow = trend === "up" ? "▲" : trend === "down" ? "▼" : "=";
  const max = Math.max(...recap.daily.map((d) => d.minutes), 1);
  const isWeek = recap.period === "week";

  return (
    <>
      <Kicker>{recapKicker(recap.period, recap.from)}</Kicker>
      <p className="mt-1 text-lg opacity-80">{periodLabel(recap.period, recap.from, recap.to)}</p>

      <div className="mt-auto">
        <p className="display-xs opacity-80">Tempo jogado</p>
        <BigTime minutes={recap.totalMinutes} className="mt-3" />
        <p className="mt-3 text-lg leading-tight">
          <span aria-hidden className="mr-1.5 font-pixel text-[12px]">
            {arrow}
          </span>
          {text}
        </p>
      </div>

      <div className="mt-6" aria-hidden>
        <div className={cn("flex h-24 items-end", isWeek ? "gap-2" : "gap-px")}>
          {recap.daily.map((day) => (
            <div
              key={day.date}
              className={cn(
                "flex-1",
                day.date > recap.today ? "bg-current/10" : "bg-current",
                day.minutes === 0 && day.date <= recap.today && "bg-current/25",
              )}
              style={{ height: day.minutes > 0 ? `${(day.minutes / max) * 100}%` : "3px" }}
            />
          ))}
        </div>
        <div
          className={cn(
            "mt-1.5 flex font-pixel text-[8px] opacity-80",
            isWeek ? "gap-2" : "justify-between",
          )}
        >
          {isWeek
            ? recap.daily.map((day, i) => (
                <span key={day.date} className="flex-1 text-center">
                  {weekdayLetters[i]}
                </span>
              ))
            : [recap.from, recap.to].map((d) => <span key={d}>{Number(d.slice(8))}</span>)}
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-3 gap-3 border-t-2 border-current/30 pt-4">
        <MiniStat label="Dias" value={`${recap.playedDays}/${recap.daily.length}`} />
        <MiniStat label="Sessões" value={recap.sessions} />
        <MiniStat label="Jogos" value={recap.gamesPlayed} />
      </dl>
      {recap.inProgress && <p className="mt-3 text-sm opacity-80">{partialNote(recap)}</p>}
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="display-xs opacity-80">{label}</dt>
      <dd className="mt-1.5 display-sm">{value}</dd>
    </div>
  );
}

function GamesSlide({ recap }: { recap: Recap }) {
  const [first, ...rest] = recap.topGames;
  if (!first) return null;
  return (
    <>
      <Kicker>Mais jogados</Kicker>
      <Title>Seu jogo {ofPeriod(recap)}</Title>

      <div className="mt-5 flex gap-4">
        <GameCover
          name={first.name}
          imageId={first.coverImageId}
          size="cover_big"
          className="w-28 shrink-0"
        />
        <div className="min-w-0">
          <p className="display-xs opacity-80">#1</p>
          <p className="mt-1 line-clamp-3 text-2xl leading-tight">{first.name}</p>
          <p className="mt-2 display-sm">{formatMinutes(first.minutes)}</p>
          <p className="text-sm opacity-80">{plural(first.sessions, "sessão", "sessões")}</p>
        </div>
      </div>

      {rest.length > 0 && (
        <ol className="mt-6 space-y-3">
          {rest.map((game, i) => (
            <li key={game.gameId} className="flex items-center gap-3">
              <span className="w-5 shrink-0 font-pixel text-[12px]">{i + 2}</span>
              <GameCover
                name={game.name}
                imageId={game.coverImageId}
                size="thumb"
                className="w-9 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg leading-tight">{game.name}</p>
                <p className="text-sm leading-tight tabular-nums opacity-80">
                  {formatMinutes(game.minutes)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-auto pt-4 text-sm opacity-80">
        {plural(recap.gamesPlayed, "jogo diferente", "jogos diferentes")} {inPeriod(recap)}
      </p>
    </>
  );
}

function GenresSlide({ recap }: { recap: Recap }) {
  const [first] = recap.topGenres;
  if (!first) return null;
  const max = first.minutes;
  return (
    <>
      <Kicker>Gêneros</Kicker>
      <Title>Você jogou muito</Title>
      <p className="mt-3 font-pixel text-[22px] leading-tight break-words">
        {genreLabel(first.genre)}
      </p>

      <ol className="mt-8 space-y-4">
        {recap.topGenres.map((genre, i) => (
          <li key={genre.genre} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-lg">
              <span className="min-w-0 truncate">
                <span className="mr-2 font-pixel text-[10px]">{i + 1}</span>
                {genreLabel(genre.genre)}
              </span>
              <span className="shrink-0 tabular-nums opacity-80">
                {formatMinutes(genre.minutes)}
              </span>
            </div>
            <Bar ratio={genre.minutes / max} />
          </li>
        ))}
      </ol>

      <p className="mt-auto pt-4 text-sm opacity-80">
        Um jogo com vários gêneros conta em todos eles.
      </p>
    </>
  );
}

function DiscoveriesSlide({ recap }: { recap: Recap }) {
  const fresh = recap.newGames.slice(0, 3);
  const back = recap.returningGames.slice(0, 3);
  return (
    <>
      <Kicker>Estreias e retornos</Kicker>
      <Title>{fresh.length > 0 ? "Novidades no controle" : "Bem-vindos de volta"}</Title>

      {/* Pouco conteúdo: o corpo fica no meio do espaço que sobra. */}
      <div className="my-auto space-y-6 py-4">
        {fresh.length > 0 && (
          <section>
            <p className="display-xs opacity-80">Primeira vez</p>
            <ul className="mt-3 grid grid-cols-3 gap-3">
              {fresh.map((game) => (
                <li key={game.gameId} className="min-w-0">
                  <GameCover name={game.name} imageId={game.coverImageId} size="cover_big" />
                  <p className="mt-2 line-clamp-2 text-sm leading-tight">{game.name}</p>
                  <p className="text-sm opacity-80">{formatMinutes(game.minutes)}</p>
                </li>
              ))}
            </ul>
            {recap.newGames.length > fresh.length && (
              <p className="mt-2 text-sm opacity-80">
                E mais {recap.newGames.length - fresh.length}.
              </p>
            )}
          </section>
        )}

        {back.length > 0 && (
          <section>
            <p className="display-xs opacity-80">De volta</p>
            <ul className="mt-3 space-y-3">
              {back.map((game) => (
                <li key={game.gameId} className="flex items-center gap-3">
                  <GameCover
                    name={game.name}
                    imageId={game.coverImageId}
                    size="thumb"
                    className="w-9 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-lg leading-tight">{game.name}</p>
                    <p className="text-sm opacity-80">depois de {game.daysAway} dias parado</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

function MomentsSlide({ recap }: { recap: Recap }) {
  const { bestDay, longestSession, longestRun } = recap;
  return (
    <>
      <Kicker>Momentos</Kicker>
      <Title>Os destaques</Title>
      <div className="my-auto space-y-7 py-4">
        {bestDay && (
          <Fact
            label="Dia mais jogado"
            value={formatMinutes(bestDay.minutes)}
            hint={dayLabel(bestDay.date)}
          />
        )}
        {longestSession && (
          <Fact
            label="Maior sessão"
            value={formatMinutes(longestSession.minutes)}
            hint={longestSession.name}
          />
        )}
        {longestRun >= 2 && (
          <Fact
            label="Sequência"
            value={plural(longestRun, "dia", "dias")}
            hint="seguidos jogando"
          />
        )}
      </div>
    </>
  );
}

function ProfileSlide({ recap }: { recap: Recap }) {
  return (
    <>
      <Kicker>Seu perfil</Kicker>
      <p className="mt-auto display-lg break-words">{profileTitle(recap.profile)}</p>
      <ul className="mt-6 space-y-2 text-xl leading-tight">
        {profileFacts(recap.profile).map((fact) => (
          <li key={fact} className="flex gap-2">
            <span aria-hidden className="font-pixel text-[10px] leading-[24px]">
              ▶
            </span>
            {fact}
          </li>
        ))}
      </ul>
      <p className="mt-auto pt-4 text-sm opacity-80">
        O horário vem das sessões de timer e da Steam.
      </p>
    </>
  );
}

const rarityFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
/** Abaixo disso, a conquista é rara de verdade: "só 4,2% dos jogadores". */
const RARE_PERCENT = 20;

function rarityText(rarity: number): string {
  const value = `${rarityFormat.format(rarity)}% dos jogadores`;
  return rarity < RARE_PERCENT ? `só ${value}` : `${value} têm`;
}

function TrophiesSlide({ recap }: { recap: Recap }) {
  const { finished, achievements } = recap;
  const shown = finished.slice(0, 3);
  return (
    <>
      <Kicker>Troféus</Kicker>
      <Title>{finished.length > 0 ? "Missão cumprida" : "Conquistas"}</Title>

      <div className="my-auto space-y-6 py-4">
        {shown.length > 0 && (
          <section>
            <p className="display-xs opacity-80">
              {plural(finished.length, "jogo zerado", "jogos zerados")}
            </p>
            <ul className="mt-3 grid grid-cols-3 gap-3">
              {shown.map((game) => (
                <li key={game.gameId} className="min-w-0">
                  <GameCover name={game.name} imageId={game.coverImageId} size="cover_big" />
                  <p className="mt-2 line-clamp-2 text-sm leading-tight">{game.name}</p>
                  <p className="text-sm opacity-80">{completionTypeLabels[game.type]}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {achievements.unlocked > 0 && (
          <section>
            <p className="display-xs opacity-80">
              {plural(achievements.unlocked, "conquista", "conquistas")} em{" "}
              {plural(achievements.games, "jogo", "jogos")}
            </p>
            {achievements.rarest && (
              <div className="mt-3 flex items-center gap-3 bg-current/10 p-3">
                {achievements.rarest.iconUrl && (
                  <img
                    src={achievements.rarest.iconUrl}
                    alt=""
                    className="size-14 shrink-0 shadow-[0_0_0_2px_var(--pixel-shadow)] [image-rendering:pixelated]"
                  />
                )}
                <div className="min-w-0">
                  <p className="display-xs opacity-80">A mais rara</p>
                  <p className="mt-1 line-clamp-2 text-lg leading-tight">
                    {achievements.rarest.title}
                  </p>
                  <p className="text-sm leading-tight opacity-80">
                    {achievements.rarest.gameName} · {rarityText(achievements.rarest.rarity)}
                  </p>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}

function SummarySlide({ recap }: { recap: Recap }) {
  const [topGame] = recap.topGames;
  const [topGenre] = recap.topGenres;
  return (
    <>
      <Kicker>{recapKicker(recap.period, recap.from)}</Kicker>
      <p className="mt-1 text-lg opacity-80">{periodLabel(recap.period, recap.from, recap.to)}</p>

      {topGame && (
        <div className="mt-5 flex items-center gap-4">
          <GameCover
            name={topGame.name}
            imageId={topGame.coverImageId}
            size="cover_big"
            className="w-20 shrink-0"
          />
          <div className="min-w-0">
            <p className="display-xs opacity-80">Jogo nº 1</p>
            <p className="mt-1 line-clamp-2 text-xl leading-tight">{topGame.name}</p>
          </div>
        </div>
      )}

      <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5">
        <SummaryStat label="Tempo" value={formatMinutes(recap.totalMinutes)} />
        <SummaryStat label="Dias jogados" value={`${recap.playedDays}/${recap.daily.length}`} />
        <SummaryStat label="Gênero nº 1" value={topGenre ? genreLabel(topGenre.genre) : "—"} />
        <SummaryStat label="Jogos" value={recap.gamesPlayed} />
        <SummaryStat label="Zerados" value={recap.finished.length} />
        <SummaryStat label="Conquistas" value={recap.achievements.unlocked} />
      </dl>

      <p className="mt-auto pt-4 font-pixel text-[12px]">
        Zer<span className="text-primary">ô</span>metro
      </p>
    </>
  );
}

function SummaryStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="display-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-xl leading-tight">{value}</dd>
    </div>
  );
}

function EmptySlide({ recap }: { recap: Recap }) {
  const isWeek = recap.period === "week";
  return (
    <>
      <Kicker>{recapKicker(recap.period, recap.from)}</Kicker>
      <p className="mt-1 text-lg opacity-80">{periodLabel(recap.period, recap.from, recap.to)}</p>
      <p className="mt-auto display-md">
        {isWeek ? "Nenhuma sessão nessa semana." : "Nenhuma sessão nesse mês."}
      </p>
      <p className="mt-4 mb-auto text-xl leading-tight opacity-80">
        {recap.inProgress
          ? `Ainda dá tempo: ${isWeek ? "a semana" : "o mês"} não acabou.`
          : "Os controles descansaram. Veja outro período nas setas acima."}
      </p>
    </>
  );
}

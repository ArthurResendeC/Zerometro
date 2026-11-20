import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import type { IgdbGamePage } from "@shared/game-page";
import type { TimeToBeat } from "@shared/igdb";
import type { LibraryItem } from "@shared/library";
import { metacriticSearchUrl, openCriticSearchUrl } from "@shared/review-sites";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/external-link";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import {
  daysBetween,
  formatCount,
  formatCountdown,
  formatHoursFromSeconds,
  formatReleaseDate,
} from "@/lib/format";
import { gamePageQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Gallery } from "./gallery";
import { GameDetails } from "./game-details";
import { RelatedGames } from "./related-games";
import { Trailer } from "./trailer";

// Aba "Sobre o jogo": dados do IGDB. Cada seção some quando o IGDB não tem o dado, para o
// jogo obscuro não virar uma página de buracos.

interface AboutTabProps {
  igdbId: number;
  /** Se o jogo está na biblioteca: com o IGDB fora do ar, ainda dá para mostrar os tempos. */
  item: LibraryItem | null;
}

export function AboutTab({ igdbId, item }: AboutTabProps) {
  const { data: game, isPending, isError } = useQuery(gamePageQuery(igdbId));

  if (isPending) return <AboutSkeleton />;
  if (isError) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">
          O IGDB não respondeu agora, então faltam a sinopse, as notas e as imagens. Tente de novo
          daqui a pouco.
        </p>
        {item?.timeToBeat && (
          <Scoreboard stats={timeToBeatStats(item.timeToBeat)} note="Tempo para zerar do IGDB" />
        )}
        {item && (
          <p className="text-sm text-muted-foreground">
            <RatingSources
              name={item.name}
              releaseYear={item.releaseYear}
              intro="Enquanto isso, veja as notas"
            />
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <GameScoreboard game={game} />
      {/* No desktop, os detalhes ficam numa coluna ao lado da sinopse e da mídia. */}
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-12">
        <div className="min-w-0 space-y-10">
          <Synopsis summary={game.summary} storyline={game.storyline} />
          {game.videos.length > 0 && (
            <Section title="Vídeos">
              <Trailer videos={game.videos} gameName={game.name} />
            </Section>
          )}
          {game.screenshotIds.length > 0 && (
            <Section title="Imagens">
              <Gallery imageIds={game.screenshotIds} gameName={game.name} />
            </Section>
          )}
        </div>
        <aside aria-label="Detalhes do jogo">
          <GameDetails game={game} />
        </aside>
      </div>
      <RelatedGames game={game} />
    </div>
  );
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="display-md">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Placar: notas e tempos para zerar (ou, se ainda não saiu, a data e a expectativa)

interface Stat {
  label: string;
  value: ReactNode;
  hint?: string;
}

function GameScoreboard({ game }: { game: IgdbGamePage }) {
  // Datas do IGDB são em UTC.
  const today = new Date(useNow(60 * 60_000)).toISOString().slice(0, 10);
  const upcoming = game.releaseDate !== null && game.releaseDate > today;
  const releaseStats: Stat[] = [];
  const ratingStats: Stat[] = [];

  if (upcoming && game.releaseDate) {
    releaseStats.push({
      label: "Lançamento",
      value: formatReleaseDate(game.releaseDate, game.releasePrecision),
      hint:
        game.releasePrecision === "day"
          ? formatCountdown(daysBetween(today, game.releaseDate))
          : undefined,
    });
    if (game.hypes > 0) {
      releaseStats.push({
        label: "Expectativa",
        value: formatCount(game.hypes),
        hint: game.hypes === 1 ? "pessoa acompanhando" : "pessoas acompanhando",
      });
    }
  }
  // A nota é a média do IGDB; o número ao lado diz de quantas notas ela saiu.
  if (game.criticRating !== null) {
    ratingStats.push({
      label: "Crítica",
      value: <ScoreChip score={game.criticRating} />,
      hint: `média de ${plural(game.criticRatingCount, "análise", "análises")}`,
    });
  }
  if (game.userRating !== null) {
    ratingStats.push({
      label: "Público",
      value: <ScoreChip score={game.userRating} />,
      hint: `média de ${plural(game.userRatingCount, "voto", "votos")}`,
    });
  }
  const stats = [...releaseStats, ...ratingStats];
  // Jogo lançado sempre ganha os links, mesmo sem nota no IGDB (é quando mais fazem falta).
  const showSources = !upcoming || ratingStats.length > 0;
  const ttb = game.timeToBeat ? timeToBeatStats(game.timeToBeat) : [];

  if (stats.length === 0 && !showSources && ttb.length === 0) return null;
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      {(stats.length > 0 || showSources) && (
        <Scoreboard
          stats={stats}
          note={
            showSources && (
              <RatingSources
                name={game.name}
                releaseYear={game.releaseYear}
                intro={sourcesIntro(game)}
              />
            )
          }
          className={ttb.length === 0 ? "md:col-span-2" : undefined}
        />
      )}
      {ttb.length > 0 && (
        <Scoreboard
          stats={ttb}
          note={
            game.timeToBeatCount > 0
              ? `Tempo para zerar do IGDB, informado por ${plural(game.timeToBeatCount, "pessoa", "pessoas")}`
              : "Tempo para zerar do IGDB"
          }
          className={stats.length === 0 && !showSources ? "md:col-span-2" : undefined}
        />
      )}
    </div>
  );
}

function sourcesIntro(game: IgdbGamePage): string {
  if (game.criticRating === null && game.userRating === null) {
    return "O IGDB ainda não tem notas deste jogo. Veja";
  }
  if (game.criticRating === null) return "Nota do IGDB, que ainda não tem a da crítica. Veja";
  return "Notas do IGDB. Compare";
}

/** De onde vêm as notas, e onde conferir: o IGDB reúne bem menos análises que os agregadores. */
function RatingSources({
  name,
  releaseYear,
  intro,
}: {
  name: string;
  releaseYear: number | null;
  /** Começo da frase, que continua com "no Metacritic e no OpenCritic". */
  intro: string;
}) {
  const link = "text-info underline underline-offset-4";
  return (
    <>
      {intro} no{" "}
      <ExternalLink href={metacriticSearchUrl(name)} className={link}>
        Metacritic
      </ExternalLink>{" "}
      e no{" "}
      <ExternalLink href={openCriticSearchUrl(name, releaseYear)} className={link}>
        OpenCritic
      </ExternalLink>
    </>
  );
}

function timeToBeatStats(ttb: TimeToBeat): Stat[] {
  const rows: [string, number | null][] = [
    ["História", ttb.mainSec],
    ["+ Extras", ttb.extraSec],
    ["100%", ttb.completeSec],
  ];
  return rows.flatMap(([label, sec]) =>
    sec ? [{ label, value: formatHoursFromSeconds(sec) }] : [],
  );
}

function Scoreboard({
  stats,
  note,
  className,
}: {
  stats: Stat[];
  note: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-3", className)}>
      {stats.length > 0 && (
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-4">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="display-xs text-muted-foreground">{s.label}</dt>
              <dd className="mt-2 display-sm tabular-nums">{s.value}</dd>
              {s.hint && <dd className="mt-1 text-xs text-muted-foreground">{s.hint}</dd>}
            </div>
          ))}
        </dl>
      )}
      {note && <p className="text-xs leading-5 text-muted-foreground">{note}</p>}
    </Card>
  );
}

/** Nota 0–100 num selo colorido (verde ≥ 75, amarelo ≥ 50, vermelho abaixo), com o número. */
function ScoreChip({ score }: { score: number }) {
  const tone =
    score >= 75
      ? "bg-score-good text-score-good-foreground"
      : score >= 50
        ? "bg-score-mixed text-score-mixed-foreground"
        : "bg-score-bad text-score-bad-foreground";
  return <span className={cn("inline-block min-w-11 px-1.5 py-1 text-center", tone)}>{score}</span>;
}

function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Sinopse (em inglês: o IGDB não tem tradução)

function Synopsis({ summary, storyline }: { summary: string | null; storyline: string | null }) {
  const [showStory, setShowStory] = useState(false);
  const text = summary ?? storyline;
  if (!text) return null;
  const extraStory = summary && storyline ? storyline : null;

  return (
    <Section
      title="Sinopse"
      aside={
        <Badge variant="outline" title="O IGDB só tem o texto em inglês">
          em inglês
        </Badge>
      }
    >
      <div className="max-w-prose space-y-4 text-lg leading-7">
        <p className="whitespace-pre-line">{text}</p>
        {extraStory && showStory && <p className="whitespace-pre-line">{extraStory}</p>}
      </div>
      {extraStory && (
        <Button variant="link" onClick={() => setShowStory((v) => !v)} aria-expanded={showStory}>
          {showStory ? "Esconder a história" : "Ler a história"}
        </Button>
      )}
    </Section>
  );
}

function AboutSkeleton() {
  return (
    <div className="space-y-10" aria-busy>
      <Skeleton className="h-28" />
      <div className="max-w-prose space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4" />
        <Skeleton className="h-4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <Skeleton className="aspect-video max-w-3xl" />
    </div>
  );
}

import type { ReactNode } from "react";
import type { GameReleaseStatus } from "@shared/game-page";
import { gameReleaseStatusLabels } from "@shared/game-labels";
import { genreLabel } from "@shared/genres";
import { coverUrl } from "@shared/igdb";
import { GameCover } from "@/components/game-cover";
import { Badge } from "@/components/ui/badge";

// Cabeçalho da página do jogo, igual nas duas abas: banner (artwork do IGDB), capa sobreposta,
// nome, ano, gêneros, quem fez e as plataformas.

export interface HeroGame {
  name: string;
  coverImageId: string | null;
  releaseYear: number | null;
  genres: string[];
  platforms: string[];
  /** Os campos abaixo só existem quando os dados do IGDB já carregaram. */
  heroImageId?: string | null;
  developers?: string[];
  publishers?: string[];
  /** Cancelado, acesso antecipado… (lançado normalmente: null). */
  releaseStatus?: GameReleaseStatus | null;
}

interface GameHeroProps {
  game: HeroGame;
  /** Selos antes das plataformas (ex.: o status na biblioteca). */
  badges?: ReactNode;
  /** Abaixo dos selos (ex.: "onde parei"). */
  children?: ReactNode;
}

export function GameHero({ game, badges, children }: GameHeroProps) {
  const studios = creditLine(game.developers ?? [], game.publishers ?? []);
  const meta = [game.releaseYear, ...game.genres.map(genreLabel)].filter(Boolean).join(" · ");

  return (
    <header className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[220px_minmax(0,1fr)] md:gap-x-8">
      <Banner game={game} />

      {/* A capa sobe por cima do banner. */}
      <div className="relative z-10 mx-auto -mt-24 w-36 self-start bg-card p-2 pixel-frame pixel-drop sm:-mt-28 sm:w-44 md:mx-0 md:-mt-36 md:w-full md:p-2.5">
        <GameCover name={game.name} imageId={game.coverImageId} size="720p" />
      </div>

      <div className="mt-5 space-y-2 text-center md:mt-6 md:text-left">
        <h1 className="text-2xl text-balance">{game.name}</h1>
        {meta && <p className="text-muted-foreground">{meta}</p>}
        {studios && <p className="text-sm text-muted-foreground">{studios}</p>}
        <div className="flex flex-wrap justify-center gap-1 pt-1 md:justify-start">
          {badges}
          {game.releaseStatus && (
            <Badge variant="secondary">{gameReleaseStatusLabels[game.releaseStatus]}</Badge>
          )}
          {game.platforms.map((p) => (
            <Badge key={p} variant="outline">
              {p}
            </Badge>
          ))}
        </div>
        {children && <div className="pt-2">{children}</div>}
      </div>
    </header>
  );
}

/**
 * Artwork largo do IGDB com degradê para o fundo e linhas de CRT. Sem artwork, a capa
 * desfocada; sem nada (ou enquanto o IGDB carrega), só o fundo com as linhas.
 */
function Banner({ game }: { game: HeroGame }) {
  const image = game.heroImageId
    ? { src: coverUrl(game.heroImageId, "1080p"), blurred: false }
    : game.coverImageId && game.heroImageId === null
      ? { src: coverUrl(game.coverImageId, "cover_big"), blurred: true }
      : null;

  return (
    <div className="relative h-44 overflow-hidden bg-card pixel-frame sm:h-60 md:col-span-2 md:h-72">
      {image && (
        <img
          src={image.src}
          alt=""
          className={
            image.blurred
              ? "absolute inset-0 size-full scale-125 object-cover opacity-50 blur-2xl"
              : "absolute inset-0 size-full object-cover object-[center_30%] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:[animation-timing-function:var(--ease-reveal)]"
          }
        />
      )}
      <div className="absolute inset-0 bg-linear-to-t from-background via-background/30 to-transparent" />
      <div className="absolute inset-0 bg-scanlines opacity-40" />
    </div>
  );
}

/** "FromSoftware · Bandai Namco Entertainment" (quem desenvolveu e quem publicou, sem repetir). */
function creditLine(developers: string[], publishers: string[]): string | null {
  const names = [...new Set([...developers.slice(0, 2), ...publishers.slice(0, 2)])];
  return names.length > 0 ? names.join(" · ") : null;
}

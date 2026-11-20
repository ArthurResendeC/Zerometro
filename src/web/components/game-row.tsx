import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { GameCover } from "@/components/game-cover";
import { cn } from "@/lib/utils";

// Fileira horizontal de capas (Descobrir, relacionados na página do jogo). Cada card leva
// para a página do jogo no Zerômetro.

export function GameRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ol
      className={cn(
        "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-3 sm:gap-4",
        className,
      )}
    >
      {children}
    </ol>
  );
}

interface GameRowCardProps {
  game: { igdbId: number; name: string; coverImageId: string | null };
  /** Selo sobre a capa (nota, posição…). */
  tag?: ReactNode;
  /** Linha pequena abaixo do nome (ano, data, gênero). */
  meta?: ReactNode;
  /** Rodapé do card (status na biblioteca, botão de adicionar). */
  footer?: ReactNode;
}

export function GameRowCard({ game, tag, meta, footer }: GameRowCardProps) {
  return (
    <li className="flex w-28 shrink-0 snap-start flex-col gap-2 sm:w-36">
      <Link
        to="/jogo/$igdbId"
        params={{ igdbId: game.igdbId }}
        className="group flex flex-col gap-2 focus-visible:outline-none"
      >
        <div className="m-1 bg-card p-2 pixel-frame transition-transform ease-[steps(2)] group-hover:-translate-y-1 group-hover:pixel-drop group-focus-visible:-translate-y-1 group-focus-visible:outline-[3px] group-focus-visible:outline-offset-[7px] group-focus-visible:outline-ring group-focus-visible:outline-solid">
          <div className="relative">
            <GameCover name={game.name} imageId={game.coverImageId} />
            {tag}
          </div>
        </div>
        <p className="line-clamp-2 min-h-10 leading-5">{game.name}</p>
      </Link>
      {meta !== undefined && (
        <p className="truncate text-xs text-muted-foreground">{meta || " "}</p>
      )}
      {footer}
    </li>
  );
}

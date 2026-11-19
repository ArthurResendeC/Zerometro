import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { gameStatusLabels } from "@shared/domain";
import type { LibraryItem } from "@shared/library";
import { GameCover } from "@/components/game-cover";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatMinutes, formatPercent } from "@/lib/format";

interface GameCardProps {
  item: LibraryItem;
  /** Mostra o status sobre a capa (útil na aba "Todos"). */
  showStatus?: boolean;
}

export function GameCard({ item, showStatus = false }: GameCardProps) {
  const played = item.minutesPlayed > 0;

  return (
    <Link
      to="/jogos/$gameId"
      params={{ gameId: item.gameId }}
      className="group flex flex-col gap-2 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="relative overflow-hidden rounded-lg ring-1 ring-border transition group-hover:ring-brand/70">
        <GameCover name={item.name} imageId={item.coverImageId} />
        {showStatus && (
          <Badge
            variant="secondary"
            className="absolute top-2 left-2 bg-background/80 backdrop-blur"
          >
            {gameStatusLabels[item.status]}
          </Badge>
        )}
      </div>
      <div className="space-y-1.5">
        <p className="line-clamp-2 text-sm leading-tight font-medium">{item.name}</p>
        <p className="text-xs text-muted-foreground">
          {played ? formatMinutes(item.minutesPlayed) : (item.releaseYear ?? "—")}
          {played && item.progress !== null && ` · ${formatPercent(item.progress)}`}
        </p>
        {played && item.progress !== null && <Progress value={item.progress * 100} />}
      </div>
    </Link>
  );
}

export function GameGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {children}
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { progressTargetLabels } from "@shared/completions";
import type { LibraryItem } from "@shared/library";
import { GameCover } from "@/components/game-cover";
import { CompletionBadge, StatusBadge } from "@/components/status-badge";
import { XpBar } from "@/components/ui/progress";
import { formatMinutes, formatPercent } from "@/lib/format";

interface GameCardProps {
  item: LibraryItem;
  /** Mostra o status sobre a capa (útil na aba "Todos"). */
  showStatus?: boolean;
}

/** Card de jogo em forma de cartucho: ranhuras no topo, capa como rótulo, progresso como barra de XP. */
export function GameCard({ item, showStatus = false }: GameCardProps) {
  const played = item.minutesPlayed > 0;
  const finished = item.status === "finished";
  // Pós-jogo sempre aparece (está na aba "Jogando", mas já foi zerado).
  const statusShown = showStatus || item.displayState === "postgame";
  // O selo de conclusão só some quando repetiria o de status ("Zerado" uma vez só).
  const { completion } = item;
  const completionShown =
    completion !== null &&
    !(statusShown && finished && completion.best === "main" && completion.count === 1);

  return (
    <Link
      to="/jogo/$igdbId"
      params={{ igdbId: item.igdbId }}
      className="group flex flex-col gap-2.5 focus-visible:outline-none"
    >
      <div className="relative m-1 bg-card px-2.5 pt-3.5 pb-2.5 pixel-frame transition-transform ease-[steps(2)] group-hover:-translate-y-1 group-hover:pixel-drop group-focus-visible:-translate-y-1 group-focus-visible:outline-[3px] group-focus-visible:outline-offset-[7px] group-focus-visible:outline-ring group-focus-visible:outline-solid before:absolute before:inset-x-6 before:top-1 before:h-1.5 before:bg-[repeating-linear-gradient(90deg,var(--border)_0_4px,transparent_4px_8px)]">
        <div className="relative">
          <GameCover name={item.name} imageId={item.coverImageId} />
          {statusShown && (
            <StatusBadge status={item.displayState} className="absolute top-1 left-1" />
          )}
          {completionShown && (
            <CompletionBadge completion={completion} className="absolute bottom-1 left-1" />
          )}
        </div>
      </div>
      <div className="space-y-1">
        {/* Sempre a altura de duas linhas: tempo e barra de XP ficam alinhados entre os cards. */}
        <p className="line-clamp-2 min-h-12 text-lg leading-6">{item.name}</p>
        <p className="text-xs text-muted-foreground">
          {played ? formatMinutes(item.minutesPlayed) : (item.releaseYear ?? "—")}
          {played && item.progress !== null && ` · ${formatPercent(item.progress)}`}
        </p>
        {played && item.progress !== null && (
          <div className="flex items-center gap-2">
            <XpBar
              value={item.progress * 100}
              tone={finished || item.progress >= 1 ? "finished" : "primary"}
              label={`Progresso estimado em ${item.name}, ${progressTargetLabels[item.progressTarget]}`}
            />
          </div>
        )}
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

import { Link } from "@tanstack/react-router";
import { type ReactNode, useId } from "react";
import { GameCover } from "@/components/game-cover";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  useCarousel,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

// Fileiras horizontais de capas. Cada card leva para a página do jogo no Zerômetro.
// - GameCarousel + GameCarouselCard: carrossel com setas ao lado do título (Descobrir).
// - GameRow + GameRowCard: scroll nativo (relacionados na página do jogo).

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

const carouselOpts = { align: "start", slidesToScroll: "auto" } as const;

/** Fileira em carrossel; o título (h3) nomeia a região para leitores de tela. */
export function GameCarousel({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <Carousel opts={carouselOpts} aria-labelledby={titleId}>
      <div className="flex min-h-11 items-center justify-between gap-4">
        <h3 id={titleId} className="display-xs text-muted-foreground">
          {title}
        </h3>
        <CarouselControls />
      </div>
      {/* Sangra até a borda da tela como o resto das fileiras. O Embla conta o padding inicial
          do container e a margem do último slide; pt/pb dão espaço ao hover e ao foco dos cards. */}
      <div className="-mx-4">
        <CarouselContent className="ml-0 px-4 pt-3 pb-1">{children}</CarouselContent>
      </div>
    </Carousel>
  );
}

/** Setas só quando há o que rolar (some numa fileira que cabe inteira). */
function CarouselControls() {
  const { canScrollPrev, canScrollNext } = useCarousel();
  if (!canScrollPrev && !canScrollNext) return null;
  return (
    <div className="-mr-3 -mb-3 flex shrink-0">
      <CarouselPrevious className="size-9" />
      <CarouselNext className="size-9" />
    </div>
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

const cardClass = "flex w-28 shrink-0 flex-col gap-2 sm:w-36";

export function GameRowCard(props: GameRowCardProps) {
  return (
    <li className={cn(cardClass, "snap-start")}>
      <GameRowCardBody {...props} />
    </li>
  );
}

export function GameCarouselCard(props: GameRowCardProps) {
  return (
    // Espaço entre slides na margem direita; a do último (mr-4) espelha o px-4 do container,
    // porque o Embla mede essa margem, não o padding final, como folga do fim.
    <CarouselItem className={cn(cardClass, "mr-3 basis-auto pl-0 last:mr-4 sm:mr-4 select-none")}>
      <GameRowCardBody {...props} />
    </CarouselItem>
  );
}

function GameRowCardBody({ game, tag, meta, footer }: GameRowCardProps) {
  return (
    <>
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
    </>
  );
}

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

// Fileiras horizontais de capas em carrossel, com setas ao lado do título (Descobrir na home,
// relacionados na página do jogo). Cada card leva para a página do jogo no Zerômetro.

const carouselOpts = { align: "start", slidesToScroll: "auto" } as const;

const headingClass = {
  h2: "display-md",
  h3: "display-xs text-muted-foreground",
} as const;

interface GameCarouselProps {
  title: string;
  /** Nível do título: h3 sob um h2 de seção (Descobrir), h2 quando a fileira é a seção. */
  heading?: keyof typeof headingClass;
  children: ReactNode;
}

/** Fileira em carrossel; o título nomeia a região para leitores de tela. */
export function GameCarousel({ title, heading: Heading = "h3", children }: GameCarouselProps) {
  const titleId = useId();
  return (
    <Carousel opts={carouselOpts} aria-labelledby={titleId}>
      <div className="flex min-h-11 items-center justify-between gap-4">
        <Heading id={titleId} className={headingClass[Heading]}>
          {title}
        </Heading>
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

export function GameCarouselCard(props: GameRowCardProps) {
  return (
    // Espaço entre slides na margem direita; a do último (mr-4) espelha o px-4 do container,
    // porque o Embla mede essa margem, não o padding final, como folga do fim.
    <CarouselItem className="mr-3 flex w-28 shrink-0 basis-auto flex-col gap-2 pl-0 select-none last:mr-4 sm:mr-4 sm:w-36">
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

import { Gamepad2 } from "lucide-react";
import { type CoverSize, coverUrl } from "@shared/igdb";
import { cn } from "@/lib/utils";

interface GameCoverProps {
  name: string;
  imageId: string | null;
  size?: CoverSize;
  className?: string;
}

/** Capa do IGDB em 3:4, com um placeholder quando o jogo não tem capa. */
export function GameCover({ name, imageId, size = "cover_big", className }: GameCoverProps) {
  if (!imageId) {
    return (
      <div
        className={cn(
          "flex aspect-3/4 w-full items-center justify-center rounded-lg bg-muted text-muted-foreground",
          className,
        )}
      >
        <Gamepad2 aria-hidden className="size-1/3" />
        <span className="sr-only">Sem capa: {name}</span>
      </div>
    );
  }
  return (
    <img
      src={coverUrl(imageId, size)}
      alt={`Capa de ${name}`}
      loading="lazy"
      className={cn("aspect-3/4 w-full rounded-lg bg-muted object-cover", className)}
    />
  );
}

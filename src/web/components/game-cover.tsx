import { useState } from "react";
import { type CoverSize, coverUrl } from "@shared/igdb";
import { cn } from "@/lib/utils";

interface GameCoverProps {
  name: string;
  imageId: string | null;
  size?: CoverSize;
  className?: string;
}

/**
 * Capa do IGDB em 3:4, sem filtro, cantos retos e contorno de 2px.
 * Sem capa (ou se ela não carregar, ex.: offline sem cache): xadrez de 4px com as iniciais
 * do jogo em fonte pixelada.
 */
export function GameCover({ name, imageId, size = "cover_big", className }: GameCoverProps) {
  const [failedId, setFailedId] = useState<string | null>(null);
  if (!imageId || failedId === imageId) {
    return (
      <div
        className={cn(
          "@container flex aspect-3/4 w-full items-center justify-center overflow-hidden bg-muted shadow-[0_0_0_2px_var(--pixel-shadow)]",
          "bg-[linear-gradient(45deg,var(--card)_25%,transparent_25%,transparent_75%,var(--card)_75%),linear-gradient(45deg,var(--card)_25%,transparent_25%,transparent_75%,var(--card)_75%)] bg-[length:8px_8px] bg-[position:0_0,4px_4px]",
          className,
        )}
      >
        <span
          aria-hidden
          className="bg-muted px-1.5 py-1 font-pixel text-[clamp(8px,25cqw,16px)] text-muted-foreground"
        >
          {initials(name)}
        </span>
        <span className="sr-only">Sem capa: {name}</span>
      </div>
    );
  }
  return (
    <img
      src={coverUrl(imageId, size)}
      alt={`Capa de ${name}`}
      loading="lazy"
      onError={() => setFailedId(imageId)}
      className={cn(
        "aspect-3/4 w-full bg-muted object-cover shadow-[0_0_0_2px_var(--pixel-shadow)]",
        className,
      )}
    />
  );
}

function initials(name: string): string {
  const [first = "?", second] = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  return (second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2)).toUpperCase();
}

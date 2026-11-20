import type { ComponentProps } from "react";
import { type GameStatus, gameStatusLabels } from "@shared/domain";
import type { LibraryItem } from "@shared/library";
import { PlusIcon, StatusIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useAddToLibrary } from "@/lib/queries";

/** Já lançado vai para "Próximos"; ainda por lançar (ou sem data), para a lista de desejos. */
export function defaultAddStatus(releaseDate: string | null, today: string): GameStatus {
  return releaseDate !== null && releaseDate <= today ? "backlog" : "wishlist";
}

interface AddToLibraryButtonProps extends Omit<
  ComponentProps<typeof Button>,
  "onClick" | "children"
> {
  game: { igdbId: number; name: string };
  status: GameStatus;
  onAdded?: (item: LibraryItem) => void;
}

/** "+ Próximos", "+ Desejos", "▶ Jogando"…: adiciona o jogo do IGDB com esse status. */
export function AddToLibraryButton({
  game,
  status,
  onAdded,
  disabled,
  ...props
}: AddToLibraryButtonProps) {
  const add = useAddToLibrary();
  return (
    <Button
      size="sm"
      variant="outline"
      {...props}
      disabled={disabled || add.isPending}
      onClick={() =>
        // mutateAsync, não mutate: o botão costuma sumir assim que o jogo entra na biblioteca,
        // e os callbacks do mutate não rodam depois que o componente desmonta. O erro já vira
        // toast no hook.
        void add
          .mutateAsync({ igdbId: game.igdbId, status })
          .then(onAdded)
          .catch(() => {})
      }
      aria-label={`Adicionar ${game.name} em ${gameStatusLabels[status]}`}
    >
      {status === "playing" ? <StatusIcon status="playing" /> : <PlusIcon />}
      {gameStatusLabels[status]}
    </Button>
  );
}

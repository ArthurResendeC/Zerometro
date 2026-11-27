import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { LibraryItem } from "@shared/library";

// "Avaliar agora?": ao zerar (história, extras ou 100%) ou abandonar um jogo, o toast oferece
// abrir a avaliação guiada.

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export function useRatePrompt(item: Pick<LibraryItem, "igdbId" | "name">) {
  const navigate = useNavigate();
  const action: ToastAction = {
    label: "Avaliar",
    onClick: () => void navigate({ to: "/jogo/$igdbId/avaliar", params: { igdbId: item.igdbId } }),
  };
  return {
    /** Para pendurar num toast que já vai aparecer (ex.: o de conclusão registrada). */
    action,
    prompt: () =>
      toast(`Avaliar ${item.name} agora?`, {
        description: "Leva uns 2 minutos, um critério por vez.",
        action,
        duration: 10_000,
      }),
  };
}

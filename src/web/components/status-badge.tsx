import { type GameStatus, gameStatusLabels } from "@shared/domain";
import { StatusIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";

/** Status de um jogo: cor + ícone + texto (nunca só cor). */
export function StatusBadge({ status, className }: { status: GameStatus; className?: string }) {
  return (
    <Badge variant={status} className={className}>
      <StatusIcon status={status} />
      {gameStatusLabels[status]}
    </Badge>
  );
}

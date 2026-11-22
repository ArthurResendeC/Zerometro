import {
  type CompletionSummary,
  completionBadgeLabels,
  type DisplayState,
  displayStateLabels,
} from "@shared/completions";
import { completionTypeLabels, type GameStatus, gameStatusLabels } from "@shared/domain";
import { type LibraryItem, type LibrarySort, sortValueOf } from "@shared/library";
import { CalendarIcon, CheckIcon, PlayIcon, StarIcon, StatusIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";

/** Status de um jogo (ou "Pós-jogo"): cor + ícone + texto (nunca só cor). */
export function StatusBadge({ status, className }: { status: DisplayState; className?: string }) {
  if (status === "postgame") {
    return (
      <Badge variant="playing" className={className}>
        <PlayIcon />
        {displayStateLabels.postgame}
      </Badge>
    );
  }
  return (
    <Badge variant={status} className={className}>
      <StatusIcon status={status} />
      {gameStatusLabels[status]}
    </Badge>
  );
}

/**
 * O selo de conclusão ao lado do de status só acrescenta algo se não repetir o "Zerado": some
 * com o jogo em Zerados, zerado uma vez só e só a história.
 */
export function completionAddsInfo(status: GameStatus, completion: CompletionSummary | null) {
  return (
    completion !== null &&
    !(status === "finished" && completion.best === "main" && completion.count === 1)
  );
}

/** Até onde chegou: "✓ Zerado", "✓ Zerado+" ou "★ 100%" (replays no `title`). */
export function CompletionBadge({
  completion,
  className,
}: {
  completion: CompletionSummary;
  className?: string;
}) {
  const { best, count } = completion;
  const title = [completionTypeLabels[best], count > 1 && `zerado ${count}x`]
    .filter(Boolean)
    .join(" · ");
  return (
    <Badge variant={best === "full" ? "full" : "finished"} className={className} title={title}>
      {best === "full" ? <StarIcon /> : <CheckIcon />}
      {completionBadgeLabels[best]}
      {count > 1 && ` ${count}x`}
    </Badge>
  );
}

const sortBadgeTitles: Record<LibrarySort, string> = {
  last_session: "Última sessão",
  started_at: "Começou a jogar",
  rating: "Sua nota",
};
const sortBadgeIcons = { last_session: CalendarIcon, started_at: PlayIcon, rating: StarIcon };

/** O valor que ordena a biblioteca: "📅 21/11/2026", "▶ 03/11/2026" ou "★ 8/10". Sem valor, nada. */
export function SortBadge({
  item,
  sort,
  className,
}: {
  item: LibraryItem;
  sort: LibrarySort;
  className?: string;
}) {
  const value = sortValueOf(item, sort);
  if (value === null) return null;
  const Icon = sortBadgeIcons[sort];
  const text = typeof value === "number" ? `${value}/10` : formatDate(value);
  return (
    <Badge
      variant="secondary"
      className={className}
      title={`${sortBadgeTitles[sort]}: ${text}`}
      aria-label={`${sortBadgeTitles[sort]}: ${text}`}
    >
      <Icon />
      {text}
    </Badge>
  );
}

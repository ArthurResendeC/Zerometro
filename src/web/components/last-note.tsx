import { todayIn } from "@shared/dates";
import type { LibraryItem } from "@shared/library";
import { PencilIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { formatDaysAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSessionNoteDialog } from "@/stores/session-note-dialog";

// "Onde parei": a nota da última sessão anotada, para lembrar de onde continuar.

/** Status em que o "onde parei" importa (no card, só nesses). */
const RESUMABLE = new Set<LibraryItem["status"]>(["playing", "paused"]);

/** Linha curta no card: "📍 Palácio 3" (o dia fica no tooltip: a nota já ocupa a linha). */
export function LastNoteLine({ item, className }: { item: LibraryItem; className?: string }) {
  const { lastNote } = item;
  if (!lastNote || !RESUMABLE.has(item.status)) return null;
  return (
    <p
      className={cn("truncate text-xs text-muted-foreground", className)}
      title={`Onde parei (${formatDaysAgo(lastNote.playedOn, todayIn())}): ${lastNote.note}`}
    >
      <span aria-hidden>📍 </span>
      <span className="sr-only">Onde parei: </span>
      {lastNote.note}
    </p>
  );
}

/**
 * Bloco na página do jogo: "Última vez (há 3 dias): Palácio 3", com o lápis para editar. Sem
 * nota, num jogo em andamento que já tem sessão, oferece anotar.
 */
export function LastNoteBlock({ item }: { item: LibraryItem }) {
  const openFor = useSessionNoteDialog((s) => s.openFor);
  const { lastNote } = item;

  if (!lastNote) {
    if (!RESUMABLE.has(item.status) || item.sessionsCount === 0) return null;
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => openFor({ gameId: item.gameId, gameName: item.name, note: "" })}
      >
        <PencilIcon /> Anotar onde parei
      </Button>
    );
  }

  return (
    <div className="flex items-start justify-center gap-2 bg-card px-3 py-2 pixel-frame md:justify-start">
      <p className="min-w-0 text-left">
        <span className="text-muted-foreground">
          Última vez ({formatDaysAgo(lastNote.playedOn, todayIn())}):{" "}
        </span>
        <span className="break-words">{lastNote.note}</span>
      </p>
      <Button
        variant="ghost"
        size="icon"
        className="-my-1 size-7 shrink-0"
        aria-label="Editar onde parei"
        onClick={() =>
          openFor({ sessionId: lastNote.sessionId, gameName: item.name, note: lastNote.note })
        }
      >
        <PencilIcon />
      </Button>
    </div>
  );
}

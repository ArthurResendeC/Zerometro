import { useState } from "react";
import { noteSchema } from "@shared/sessions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useNoteLastSession, useUpdateSession } from "@/lib/queries";
import { type SessionNoteTarget, useSessionNoteDialog } from "@/stores/session-note-dialog";

const SAVED = "Anotado onde você parou";

/** Tamanho máximo da nota (o mesmo do servidor). */
const MAX_NOTE = noteSchema.maxLength ?? 500;

/** "Onde parou?": grava a nota de uma sessão (aberto pelo toast do "Parei" e pela página do jogo). */
export function SessionNoteDialog() {
  const { target, close } = useSessionNoteDialog();
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Onde parou?</DialogTitle>
          <DialogDescription>
            {target ? `${target.gameName}: ` : ""}aparece no card e na página do jogo para você
            lembrar de onde continuar.
          </DialogDescription>
        </DialogHeader>
        {/* Desmonta ao fechar: o campo sempre abre com a nota da sessão escolhida. */}
        {target && (
          <NoteForm
            key={`${target.sessionId ?? ""}:${target.gameId ?? ""}`}
            target={target}
            onDone={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NoteForm({ target, onDone }: { target: SessionNoteTarget; onDone: () => void }) {
  const [note, setNote] = useState(target.note);
  const update = useUpdateSession({ successMessage: SAVED });
  const noteLast = useNoteLastSession({ successMessage: SAVED });
  const isPending = update.isPending || noteLast.isPending;
  const changed = note.trim() !== target.note.trim();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!changed) return onDone();
        const text = note.trim();
        if (target.sessionId !== undefined) {
          update.mutate(
            { id: target.sessionId, patch: { note: text || null } },
            { onSuccess: onDone },
          );
        } else if (target.gameId !== undefined) {
          noteLast.mutate({ gameId: target.gameId, note: text }, { onSuccess: onDone });
        }
      }}
    >
      <Input
        aria-label="Onde parou"
        placeholder="Ex.: Palácio 3, antes do chefe"
        value={note}
        maxLength={MAX_NOTE}
        onChange={(e) => setNote(e.target.value)}
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {target.note ? "Cancelar" : "Pular"}
        </Button>
        <Button type="submit" disabled={isPending}>
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}

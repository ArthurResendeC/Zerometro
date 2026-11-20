import { useState } from "react";
import { DEFAULT_TIME_ZONE, zonedParts } from "@shared/dates";
import { GameCover } from "@/components/game-cover";
import { TrashIcon, UploadIcon } from "@/components/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatDate, formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useOutbox, useUserOutbox } from "./outbox";
import type { OutboxItem } from "./outbox-core";
import { syncOutbox, useSyncing } from "./sync";
import { useOnline } from "./use-online";

/**
 * "↑ N" no cabeçalho enquanto houver ações feitas offline ainda não aceitas pelo servidor.
 * Abre a lista: o que é cada uma, se está esperando ou foi recusada (e por quê), "Enviar agora"
 * e "Descartar".
 */
export function PendingIndicator({ userId, className }: { userId: string; className?: string }) {
  const items = useUserOutbox(userId);
  const online = useOnline();
  const syncing = useSyncing();
  const [open, setOpen] = useState(false);
  if (items.length === 0 && !open) return null;

  const failed = items.filter((item) => item.status === "failed").length;
  const pending = items.length - failed;
  const label = [
    pending > 0 && `${pending} ${pending === 1 ? "ação pendente" : "ações pendentes"}`,
    failed > 0 && `${failed} ${failed === 1 ? "recusada" : "recusadas"}`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={label}
          title={label}
          className={cn(
            "gap-1 px-2 tabular-nums",
            failed > 0 ? "text-destructive" : "text-muted-foreground",
            className,
          )}
        >
          <UploadIcon className={cn(syncing && "animate-pulse")} />
          <span className="display-xs">{items.length}</span>
          {failed > 0 && <span aria-hidden>!</span>}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pendentes</DialogTitle>
          <DialogDescription>
            {pending === 0
              ? "O servidor não aceitou. Veja o motivo e descarte quando quiser."
              : online
                ? "Feitas sem conexão. Vão para o servidor sozinhas, em ordem."
                : "Sem conexão agora. Ficam guardadas neste aparelho até ela voltar."}
          </DialogDescription>
        </DialogHeader>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tudo enviado.</p>
        ) : (
          <ul className="grid gap-3">
            {items.map((item) => (
              <PendingRow key={item.id} item={item} online={online} />
            ))}
          </ul>
        )}
        {pending > 0 && (
          <DialogFooter>
            <Button type="button" disabled={!online || syncing} onClick={() => void syncOutbox()}>
              <UploadIcon />
              {syncing ? "Enviando…" : "Enviar agora"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PendingRow({ item, online }: { item: OutboxItem; online: boolean }) {
  const discard = useOutbox((state) => state.discard);
  const { game } = item.op;
  const dependents = useOutbox(
    (state) => state.items.filter((i) => i.dependsOn === item.id).length,
  );

  return (
    <li className="flex items-start gap-3">
      <GameCover name={game.name} imageId={game.coverImageId} size="thumb" className="w-8" />
      <div className="min-w-0 flex-1">
        <p className="truncate">{game.name}</p>
        <p className="text-sm text-muted-foreground">{describe(item)}</p>
        <p
          className={cn(
            "text-sm",
            item.status === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {item.status === "failed"
            ? `Recusada: ${item.error ?? "erro desconhecido"}`
            : online
              ? "Esperando envio"
              : "Esperando conexão"}
        </p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            aria-label={`Descartar: ${game.name}, ${describe(item)}`}
          >
            <TrashIcon />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar?</AlertDialogTitle>
            <AlertDialogDescription>
              {game.name}: {describe(item).toLowerCase()}. Não vai para o servidor e não dá para
              desfazer.
              {dependents > 0 && " O fim deste timer, também na fila, vai junto."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter</AlertDialogCancel>
            <AlertDialogAction onClick={() => discard(item.id)}>Descartar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

const time = (iso: string) => zonedParts(new Date(iso), DEFAULT_TIME_ZONE).time;
const day = (iso: string) => formatDate(zonedParts(new Date(iso), DEFAULT_TIME_ZONE).date);

/** "Sessão de 30min em 20/11/2026", "Começou às 14:05", "Parou às 15:00 (55min)"… */
function describe({ op }: OutboxItem): string {
  switch (op.kind) {
    case "log":
      return `Sessão de ${formatMinutes(op.input.minutes)} em ${formatDate(op.input.playedOn)}`;
    case "timer.start":
      return `Começou às ${time(op.input.startedAt)} de ${day(op.input.startedAt)}`;
    case "timer.stop": {
      const minutes = Math.round(
        (Date.parse(op.input.endedAt) - Date.parse(op.startedAt)) / 60_000,
      );
      return `Parou às ${time(op.input.endedAt)} (${formatMinutes(minutes)})`;
    }
    case "timer.cancel":
      return "Descartou o timer";
  }
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { create } from "zustand";
import { DEFAULT_TIME_ZONE, nextOccurrence, zonedParts } from "@shared/dates";
import { MAX_MINUTES_PER_DAY } from "@shared/sessions";
import { GameCover } from "@/components/game-cover";
import { CloseIcon, PlayIcon, StopIcon } from "@/components/icons";
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
import { Button, type buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currentUserId } from "@/features/offline/actions";
import { useUserOutbox } from "@/features/offline/outbox";
import { type EffectiveTimer, effectiveTimer } from "@/features/offline/outbox-core";
import { useNow } from "@/hooks/use-now";
import { formatDate, formatMinutes } from "@/lib/format";
import {
  settingsQuery,
  timerQuery,
  useCancelTimer,
  useStartTimer,
  useStopTimer,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

// ---------------------------------------------------------------------------
// Estado

/**
 * Timer ativo + cronômetro corrigido pelo relógio do servidor. É o "efetivo": o do servidor com
 * as ações feitas offline (fila) aplicadas por cima, inclusive um timer que ainda não chegou lá.
 */
export function useActiveTimer() {
  const { data } = useQuery(timerQuery());
  const items = useUserOutbox(currentUserId(useQueryClient()));
  const active = effectiveTimer(data?.active ?? null, items, DEFAULT_TIME_ZONE);
  return { active, clockOffsetMs: data?.clockOffsetMs ?? 0 };
}

function elapsedMs(active: EffectiveTimer, now: number, clockOffsetMs: number): number {
  return Math.max(0, now + clockOffsetMs - Date.parse(active.startedAt));
}

/** 01:05:09 */
function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

const useLongSessionDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>()(
  (set) => ({ open: false, setOpen: (open) => set({ open }) }),
);

/** "Parei": para direto, ou pergunta "jogou tudo isso mesmo?" se passou do limite dos ajustes. */
function useRequestStop() {
  const { active, clockOffsetMs } = useActiveTimer();
  const { data: settings } = useQuery(settingsQuery());
  const stop = useStopTimer();
  const openDialog = useLongSessionDialog((s) => s.setOpen);

  return {
    isPending: stop.isPending,
    requestStop: () => {
      if (!active) return;
      const minutes = elapsedMs(active, Date.now(), clockOffsetMs) / 60_000;
      if (minutes >= (settings?.longSessionMinutes ?? 360)) openDialog(true);
      else stop.mutate({});
    },
  };
}

// ---------------------------------------------------------------------------
// Barra fixa no cabeçalho (todas as telas)

export function TimerBar() {
  const { active, clockOffsetMs } = useActiveTimer();
  const now = useNow();
  const { requestStop, isPending } = useRequestStop();
  const cancel = useCancelTimer();

  if (!active) return null;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-3">
      <div className="frame-space-drop flex items-center gap-3 bg-card py-1 pr-1 pl-3 pixel-frame pixel-drop sm:gap-4">
        <span className="size-2 shrink-0 animate-blink bg-destructive" aria-hidden />
        <GameCover
          name={active.gameName}
          imageId={active.coverImageId}
          size="thumb"
          className="hidden w-7 shrink-0 sm:block"
        />
        <Link
          to="/jogo/$igdbId"
          params={{ igdbId: active.igdbId }}
          className="min-w-0 truncate hover:underline"
        >
          <span className="hidden text-muted-foreground sm:inline">Jogando </span>
          <span>{active.gameName}</span>
        </Link>
        {active.pending && (
          <span
            className="shrink-0 display-xs text-muted-foreground max-sm:hidden"
            title="Começou sem conexão: vai para o servidor quando ela voltar"
          >
            offline
          </span>
        )}
        <span
          className="display-sm text-primary tabular-nums sm:display-md"
          role="timer"
          aria-label="Tempo de jogo"
        >
          {formatClock(elapsedMs(active, now, clockOffsetMs))}
        </span>
        <div className="ml-auto flex shrink-0 items-center">
          <Button size="sm" onClick={requestStop} disabled={isPending}>
            <StopIcon /> Parei
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" className="size-9" aria-label="Descartar timer">
                <CloseIcon />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Descartar o timer?</AlertDialogTitle>
                <AlertDialogDescription>
                  O tempo de {active.gameName} desde{" "}
                  {zonedParts(new Date(active.startedAt), DEFAULT_TIME_ZONE).time} não será
                  registrado.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Continuar jogando</AlertDialogCancel>
                <AlertDialogAction onClick={() => cancel.mutate()}>Descartar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <LongSessionDialog />
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Jogou tudo isso mesmo?"

function LongSessionDialog() {
  const { open, setOpen } = useLongSessionDialog();
  const { active, clockOffsetMs } = useActiveTimer();

  return (
    <Dialog open={open && Boolean(active)} onOpenChange={setOpen}>
      <DialogContent>
        {active && (
          <LongSessionForm
            active={active}
            clockOffsetMs={clockOffsetMs}
            onDone={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LongSessionForm({
  active,
  clockOffsetMs,
  onDone,
}: {
  active: EffectiveTimer;
  clockOffsetMs: number;
  onDone: () => void;
}) {
  const stop = useStopTimer();
  const [now] = useState(() => Date.now() + clockOffsetMs);
  const [endTime, setEndTime] = useState(() => zonedParts(new Date(now), DEFAULT_TIME_ZONE).time);

  const start = new Date(active.startedAt);
  const startLocal = zonedParts(start, DEFAULT_TIME_ZONE);
  const elapsedMinutes = Math.floor((now - start.getTime()) / 60_000);
  const tooLong = elapsedMinutes > MAX_MINUTES_PER_DAY;

  // Prévia da duração com o horário informado (mesma regra do servidor: antes do início = dia seguinte).
  const end = /^\d{2}:\d{2}$/.test(endTime)
    ? nextOccurrence(start, endTime, DEFAULT_TIME_ZONE)
    : null;
  const previewMinutes = end ? Math.round((end.getTime() - start.getTime()) / 60_000) : null;
  const endInFuture = end ? end.getTime() > now + 60_000 : false;

  const submit = (input: { endTime?: string }) => stop.mutate(input, { onSuccess: onDone });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Jogou tudo isso mesmo?</DialogTitle>
        <DialogDescription>
          O timer de {active.gameName} está ligado há {formatMinutes(elapsedMinutes)}, desde{" "}
          {startLocal.time} de {formatDate(startLocal.date)}.
        </DialogDescription>
      </DialogHeader>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit({ endTime });
        }}
      >
        <Label htmlFor="end-time">Parei às</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="end-time"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-32"
          />
          <Button
            type="submit"
            disabled={
              stop.isPending || previewMinutes === null || previewMinutes < 1 || endInFuture
            }
          >
            Salvar {previewMinutes !== null && previewMinutes >= 1 && formatMinutes(previewMinutes)}
          </Button>
        </div>
        {endInFuture && (
          <p className="text-xs text-destructive">✕ Esse horário ainda não chegou.</p>
        )}
      </form>

      <div className="flex flex-col border-t-(length:--rule) border-dashed border-muted pt-4 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          disabled={stop.isPending || tooLong}
          onClick={() => submit({})}
          title={tooLong ? "Uma sessão vai até 24h: informe o horário em que parou" : undefined}
        >
          Sim, parar agora ({formatMinutes(elapsedMinutes)})
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Botão "Comecei a jogar" / "Parei" de um jogo

interface TimerButtonProps extends VariantProps<typeof buttonVariants> {
  gameId: number;
  className?: string;
  /** Em colunas estreitas (cards no celular), mostra só "Jogar". */
  compact?: boolean;
}

export function TimerButton({ gameId, className, size, variant, compact }: TimerButtonProps) {
  const { active } = useActiveTimer();
  const start = useStartTimer();
  const { requestStop, isPending } = useRequestStop();

  if (active?.gameId === gameId) {
    return (
      <Button
        size={size}
        variant="secondary"
        className={className}
        onClick={requestStop}
        disabled={isPending}
      >
        <StopIcon /> Parei
      </Button>
    );
  }
  return (
    <Button
      size={size}
      variant={variant}
      className={cn(className)}
      onClick={() => start.mutate({ gameId })}
      disabled={start.isPending}
    >
      <PlayIcon />
      {compact ? (
        <>
          <span className="sm:hidden">Jogar</span>
          <span className="hidden sm:inline">Comecei a jogar</span>
        </>
      ) : (
        "Comecei a jogar"
      )}
    </Button>
  );
}

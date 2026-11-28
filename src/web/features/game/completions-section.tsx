import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { completionBadgeLabels } from "@shared/completions";
import { todayIn } from "@shared/dates";
import {
  type CompletionType,
  completionTypeLabels,
  completionTypes,
  gameStatusLabels,
} from "@shared/domain";
import type { LibraryItem } from "@shared/library";
import { DateInput, dateField } from "@/components/date-input";
import { FieldErrors } from "@/components/field-errors";
import { CheckIcon, StarIcon, TrashIcon } from "@/components/icons";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { completionsQuery, useMarkCompleted, useRemoveCompletion } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useRatePrompt } from "@/features/rating/use-rate-prompt";

// Conclusões do jogo (história, + extras, 100%) na aba "Minhas sessões": histórico e o diálogo
// de "Marcar como zerado".

const typeHints: Record<CompletionType, string> = {
  main: "Zerei a história",
  extras: "História + conteúdo extra",
  full: "Tudo: 100%, platina",
};

export function CompletionsSection({
  item,
  onMarkCompleted,
}: {
  item: LibraryItem;
  onMarkCompleted: () => void;
}) {
  const { data: completions } = useQuery(completionsQuery(item.gameId));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="display-md">Conclusões</h2>
        <Button size="sm" onClick={onMarkCompleted}>
          <CheckIcon />
          <span className="sm:hidden">Zerei</span>
          <span className="max-sm:hidden">Marcar como zerado</span>
        </Button>
      </div>
      <Card className="gap-2">
        {!completions ? (
          <Skeleton className="h-6 w-2/3" />
        ) : completions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ainda não zerado. Quando zerar, registre aqui: só a história, com os extras ou 100%. Dá
            para registrar replays também.
          </p>
        ) : (
          <ol className="divide-y-(length:--rule) divide-border">
            {completions.map((completion) => (
              <li key={completion.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <Badge variant={completion.type === "full" ? "full" : "finished"}>
                  {completion.type === "full" ? <StarIcon /> : <CheckIcon />}
                  {completionBadgeLabels[completion.type]}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p>
                    {completionTypeLabels[completion.type]}
                    <span className="text-muted-foreground">
                      {" "}
                      · {formatDate(completion.completedOn)}
                    </span>
                  </p>
                  {completion.note && (
                    <p className="text-sm text-muted-foreground">{completion.note}</p>
                  )}
                </div>
                <RemoveCompletionButton
                  gameId={item.gameId}
                  id={completion.id}
                  label={`${completionTypeLabels[completion.type]} em ${formatDate(completion.completedOn)}`}
                />
              </li>
            ))}
          </ol>
        )}
      </Card>
    </section>
  );
}

function RemoveCompletionButton({
  gameId,
  id,
  label,
}: {
  gameId: number;
  id: number;
  label: string;
}) {
  const remove = useRemoveCompletion(gameId);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Apagar conclusão: ${label}`}>
          <TrashIcon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Apagar esta conclusão?</AlertDialogTitle>
          <AlertDialogDescription>
            {label}. O status do jogo não muda. Não dá para desfazer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => remove.mutate(id)}>Apagar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Diálogo "Marcar como zerado"

interface CompleteDialogProps {
  item: LibraryItem;
  /** Tipo já escolhido ao abrir (ex.: 100% depois de concluir todos os objetivos); null = fechado. */
  openWith: CompletionType | null;
  onClose: () => void;
}

export function CompleteDialog({ item, openWith, onClose }: CompleteDialogProps) {
  return (
    <Dialog open={openWith !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar como zerado</DialogTitle>
          <DialogDescription>{item.name}</DialogDescription>
        </DialogHeader>
        {/* O conteúdo desmonta ao fechar: o formulário sempre abre limpo. */}
        {openWith && <CompleteForm item={item} initialType={openWith} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

/** Qual botão enviou o formulário. */
interface SubmitMeta {
  moveToFinished: boolean;
}

function CompleteForm({
  item,
  initialType,
  onDone,
}: {
  item: LibraryItem;
  initialType: CompletionType;
  onDone: () => void;
}) {
  const { action: rateAction } = useRatePrompt(item);
  const mark = useMarkCompleted(item.gameId, { rateAction });
  const [today] = useState(() => todayIn());

  const form = useForm({
    defaultValues: { type: initialType, date: today, note: "" },
    onSubmitMeta: { moveToFinished: false } as SubmitMeta,
    onSubmit: async ({ value, meta }) => {
      await mark.mutateAsync({
        type: value.type,
        date: value.date,
        note: value.note.trim() || null,
        moveToFinished: meta.moveToFinished,
      });
      onDone();
    },
  });
  const submit = (meta: SubmitMeta) => void form.handleSubmit(meta);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit({ moveToFinished: item.status !== "playing" && item.status !== "finished" });
      }}
      className="space-y-4"
    >
      <form.Field name="type">
        {(field) => (
          <fieldset className="space-y-2">
            <legend className="mb-2 display-xs">Até onde?</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {completionTypes.map((type) => {
                const checked = field.state.value === type;
                return (
                  <label
                    key={type}
                    className={cn(
                      "m-0.5 flex cursor-pointer flex-col items-start gap-1 p-3 pixel-frame-thin has-focus-visible:outline-[3px] has-focus-visible:outline-offset-2 has-focus-visible:outline-ring has-focus-visible:outline-solid",
                      checked
                        ? "bg-primary text-primary-foreground [--px-frame-color:var(--primary)]"
                        : "hover:bg-accent",
                    )}
                  >
                    <input
                      type="radio"
                      name="completion-type"
                      value={type}
                      checked={checked}
                      onChange={() => field.handleChange(type)}
                      aria-label={completionTypeLabels[type]}
                      className="sr-only"
                    />
                    <span className="display-xs">{completionTypeLabels[type]}</span>
                    <span
                      className={cn(
                        "text-xs",
                        checked ? "text-primary-foreground" : "text-muted-foreground",
                      )}
                    >
                      {typeHints[type]}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
      </form.Field>

      <form.Field name="date" validators={{ onSubmit: dateField({ max: today }) }}>
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor="completion-date">Quando</Label>
            <DateInput
              id="completion-date"
              max={today}
              value={field.state.value}
              onChange={field.handleChange}
              aria-invalid={field.state.meta.errors.length > 0}
            />
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>

      <form.Field name="note" validators={{ onSubmit: z.string().max(500) }}>
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor="completion-note">Anotação (opcional)</Label>
            <Textarea
              id="completion-note"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="Final verdadeiro, NG+, platina…"
              maxLength={500}
              rows={2}
            />
          </div>
        )}
      </form.Field>

      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => (
          <DialogFooter>
            {item.status === "finished" ? (
              <Button type="submit" disabled={isSubmitting}>
                Salvar
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => submit({ moveToFinished: false })}
                >
                  {item.status === "playing"
                    ? "Continuar jogando (pós-jogo)"
                    : `Manter em ${gameStatusLabels[item.status]}`}
                </Button>
                <Button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => submit({ moveToFinished: true })}
                >
                  Mover para Zerados
                </Button>
              </>
            )}
          </DialogFooter>
        )}
      </form.Subscribe>
    </form>
  );
}

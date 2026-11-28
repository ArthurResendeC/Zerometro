import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { LibraryItem } from "@shared/library";
import {
  addObjectiveSchema,
  MAX_OBJECTIVE_TARGET,
  type ObjectiveItem,
  objectiveDone,
} from "@shared/objectives";
import { FieldErrors } from "@/components/field-errors";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/icons";
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
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { XpBar } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPercent } from "@/lib/format";
import {
  type ObjectiveChange,
  isObjectiveWrite,
  objectivesQuery,
  useObjectiveChange,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

// Objetivos do jogo na aba "Minhas sessões": checkbox (alvo 1) ou contador (−/+ e campo),
// com barra geral. Concluir o último sugere marcar o jogo como 100%.

interface ObjectivesSectionProps {
  item: LibraryItem;
  /** Chamado quando a API sugere marcar 100% (acabou de concluir todos). */
  onAllDone: () => void;
}

export function ObjectivesSection({ item, onAllDone }: ObjectivesSectionProps) {
  const { data: objectives } = useQuery(objectivesQuery(item.gameId));
  const change = useObjectiveChange(item.gameId);

  /**
   * Envia a mudança; se ela concluiu o último objetivo e falta o 100%, pergunta. Resolve com
   * `false` se falhou (o erro já aparece num toast).
   */
  const apply = (next: ObjectiveChange) =>
    change.mutateAsync(next).then(
      (result) => {
        if (isObjectiveWrite(result) && result.suggestFullCompletion) onAllDone();
        return true;
      },
      () => false,
    );

  const total = objectives?.length ?? 0;
  const done = objectives?.filter(objectiveDone).length ?? 0;

  return (
    <section className="space-y-3">
      <h2 className="display-md">Objetivos</h2>
      <Card className="gap-4">
        {!objectives ? (
          <Skeleton className="h-6 w-2/3" />
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground">
            Adicione objetivos para acompanhar o que falta: chefes opcionais, colecionáveis (ex.:
            900 sementes Korok), conquistas…
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <XpBar
                value={(done / total) * 100}
                cells={20}
                tone={done === total ? "finished" : "info"}
                label="Objetivos concluídos"
              />
              <span className="display-xs whitespace-nowrap tabular-nums">
                {done}/{total} · {formatPercent(done / total)}
              </span>
            </div>
            <ol className="divide-y-(length:--rule) divide-border">
              {objectives.map((objective, index) => (
                <ObjectiveRow
                  key={objective.id}
                  objective={objective}
                  onChange={apply}
                  onMove={(delta) => {
                    const ids = objectives.map((o) => o.id);
                    const target = index + delta;
                    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
                    void apply({ kind: "reorder", ids });
                  }}
                  first={index === 0}
                  last={index === total - 1}
                />
              ))}
            </ol>
          </>
        )}
        <AddObjectiveForm onAdd={(input) => apply({ kind: "add", input })} />
      </Card>
    </section>
  );
}

interface ObjectiveRowProps {
  objective: ObjectiveItem;
  onChange: (change: ObjectiveChange) => Promise<boolean>;
  onMove: (delta: -1 | 1) => void;
  first: boolean;
  last: boolean;
}

function ObjectiveRow({ objective, onChange, onMove, first, last }: ObjectiveRowProps) {
  const [editing, setEditing] = useState(false);
  const done = objectiveDone(objective);
  const counter = objective.target > 1;
  const { id } = objective;

  if (editing) {
    return (
      <li className="py-3 first:pt-0 last:pb-0">
        <EditObjectiveForm
          objective={objective}
          onSave={(patch) =>
            onChange({ kind: "update", id, patch }).then((ok) => ok && setEditing(false))
          }
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 first:pt-0 last:pb-0">
      {counter ? (
        <p className={cn("min-w-0 flex-1 basis-40", done && "text-muted-foreground line-through")}>
          {objective.title}
        </p>
      ) : (
        <label className="flex min-w-0 flex-1 basis-40 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={done}
            onChange={(e) =>
              void onChange({
                kind: "update",
                id,
                patch: { progress: e.target.checked ? objective.target : 0 },
              })
            }
            aria-label={objective.title}
            className="peer sr-only"
          />
          <span
            aria-hidden
            className={cn(
              "m-0.5 grid size-6 shrink-0 place-items-center pixel-frame-thin peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-focus-visible:outline-solid [&_svg]:size-3",
              done
                ? "bg-status-finished text-status-finished-foreground [--px-frame-color:var(--status-finished)]"
                : "bg-background",
            )}
          >
            {done && <CheckIcon />}
          </span>
          <span className={cn("min-w-0", done && "text-muted-foreground line-through")}>
            {objective.title}
          </span>
        </label>
      )}

      {counter && <Counter objective={objective} onChange={onChange} />}

      <div className="flex shrink-0">
        <Button
          variant="ghost"
          size="icon"
          // Na ponta da lista a seta some, mas guarda o lugar (as outras não pulam).
          className={cn("size-9", first && "invisible")}
          aria-label={`Subir ${objective.title}`}
          disabled={first}
          onClick={() => onMove(-1)}
        >
          <ArrowUpIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          // Na ponta da lista a seta some, mas guarda o lugar (as outras não pulam).
          className={cn("size-9", last && "invisible")}
          aria-label={`Descer ${objective.title}`}
          disabled={last}
          onClick={() => onMove(1)}
        >
          <ArrowDownIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-9"
          aria-label={`Editar ${objective.title}`}
          onClick={() => setEditing(true)}
        >
          <PencilIcon />
        </Button>
        <DeleteObjectiveButton
          title={objective.title}
          onDelete={() => void onChange({ kind: "delete", id })}
        />
      </div>
    </li>
  );
}

/** −/+ e o número editável ("12 / 900"); o campo envia ao sair ou com Enter. */
function Counter({
  objective,
  onChange,
}: {
  objective: ObjectiveItem;
  onChange: (change: ObjectiveChange) => Promise<boolean>;
}) {
  const { id, progress, target } = objective;
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const value = Number(draft);
    setDraft(null);
    if (draft.trim() !== "" && Number.isInteger(value) && value !== progress) {
      void onChange({ kind: "update", id, patch: { progress: value } });
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        className="size-9"
        aria-label={`Menos 1 em ${objective.title}`}
        disabled={progress <= 0}
        onClick={() => void onChange({ kind: "increment", id, by: -1 })}
      >
        <MinusIcon />
      </Button>
      <Input
        inputMode="numeric"
        aria-label={`Progresso em ${objective.title}`}
        value={draft ?? String(progress)}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        className="h-9 w-20 text-center tabular-nums"
      />
      <span className="w-14 text-sm whitespace-nowrap text-muted-foreground tabular-nums">
        / {target}
      </span>
      <Button
        variant="outline"
        size="icon"
        className="size-9"
        aria-label={`Mais 1 em ${objective.title}`}
        disabled={progress >= target}
        onClick={() => void onChange({ kind: "increment", id, by: 1 })}
      >
        <PlusIcon />
      </Button>
    </div>
  );
}

function DeleteObjectiveButton({ title, onDelete }: { title: string; onDelete: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9" aria-label={`Apagar ${title}`}>
          <TrashIcon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Apagar este objetivo?</AlertDialogTitle>
          <AlertDialogDescription>{title}. Não dá para desfazer.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onDelete}>Apagar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Formulários (adicionar e editar)

/** O alvo vem do campo como texto: vazio = 1 (checkbox). */
const parseTarget = (value: string) => (value.trim() === "" ? 1 : Number(value));

const targetError = (value: string) => {
  const target = parseTarget(value);
  if (!Number.isInteger(target) || target < 1) return "O alvo é um número a partir de 1";
  if (target > MAX_OBJECTIVE_TARGET) return "O alvo vai até 100.000";
  return undefined;
};

function AddObjectiveForm({
  onAdd,
}: {
  onAdd: (input: { title: string; target: number }) => Promise<boolean>;
}) {
  const form = useForm({
    defaultValues: { title: "", target: "" },
    onSubmit: async ({ value, formApi }) => {
      const ok = await onAdd({ title: value.title.trim(), target: parseTarget(value.target) });
      if (ok) formApi.reset();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className="flex flex-wrap items-end gap-x-2 gap-y-3"
    >
      <form.Field name="title" validators={{ onSubmit: addObjectiveSchema.shape.title }}>
        {(field) => (
          <div className="min-w-0 flex-1 basis-56 space-y-2">
            <Label htmlFor="objective-title">Novo objetivo</Label>
            <Input
              id="objective-title"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="Ex.: Sementes Korok"
              maxLength={120}
              aria-invalid={field.state.meta.errors.length > 0}
            />
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="target" validators={{ onSubmit: ({ value }) => targetError(value) }}>
        {(field) => (
          <div className="w-28 space-y-2">
            <Label htmlFor="objective-target">Alvo</Label>
            <Input
              id="objective-target"
              inputMode="numeric"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value.replace(/\D/g, ""))}
              placeholder="1"
              aria-invalid={field.state.meta.errors.length > 0}
            />
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" variant="outline" disabled={isSubmitting} className="mb-1">
            <PlusIcon /> Adicionar
          </Button>
        )}
      </form.Subscribe>
      <p className="basis-full text-xs text-muted-foreground">
        Alvo 1 vira uma caixinha de marcar; mais que 1, um contador.
      </p>
    </form>
  );
}

function EditObjectiveForm({
  objective,
  onSave,
  onCancel,
}: {
  objective: ObjectiveItem;
  onSave: (patch: { title: string; target: number }) => Promise<unknown>;
  onCancel: () => void;
}) {
  const form = useForm({
    defaultValues: { title: objective.title, target: String(objective.target) },
    onSubmit: ({ value }) =>
      onSave({ title: value.title.trim(), target: parseTarget(value.target) }),
  });
  const prefix = `objective-${objective.id}`;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className="flex flex-wrap items-end gap-x-2 gap-y-3"
    >
      <form.Field name="title" validators={{ onSubmit: addObjectiveSchema.shape.title }}>
        {(field) => (
          <div className="min-w-0 flex-1 basis-56 space-y-2">
            <Label htmlFor={`${prefix}-title`}>Objetivo</Label>
            <Input
              id={`${prefix}-title`}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              maxLength={120}
              aria-invalid={field.state.meta.errors.length > 0}
            />
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="target" validators={{ onSubmit: ({ value }) => targetError(value) }}>
        {(field) => (
          <div className="w-28 space-y-2">
            <Label htmlFor={`${prefix}-target`}>Alvo</Label>
            <Input
              id={`${prefix}-target`}
              inputMode="numeric"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value.replace(/\D/g, ""))}
              aria-invalid={field.state.meta.errors.length > 0}
            />
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <div className="mb-1 flex">
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" size="sm" disabled={isSubmitting}>
              Salvar
            </Button>
          )}
        </form.Subscribe>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

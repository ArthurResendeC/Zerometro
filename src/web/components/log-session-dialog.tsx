import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { addDays, isoDateSchema, todayIn } from "@shared/dates";
import { gameStatuses, gameStatusLabels } from "@shared/domain";
import type { LibraryItem } from "@shared/library";
import { MAX_MINUTES_PER_DAY, type PlaySessionItem } from "@shared/sessions";
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
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatMinutes } from "@/lib/format";
import { libraryListQuery, useLogSession, useUpdateSession } from "@/lib/queries";
import { useLogSessionDialog } from "@/stores/log-session-dialog";

/** Modal global de "Registrar sessão" (e edição de sessão). Montado uma vez no layout. */
export function LogSessionDialog() {
  const { open, close, editing, gameId } = useLogSessionDialog();

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar sessão" : "Registrar sessão"}</DialogTitle>
          <DialogDescription>
            {editing ? editing.gameName : "Quanto tempo você jogou e quando."}
          </DialogDescription>
        </DialogHeader>
        {/* O conteúdo desmonta ao fechar, então o formulário sempre abre limpo. */}
        <SessionForm editing={editing} initialGameId={gameId} onDone={close} />
      </DialogContent>
    </Dialog>
  );
}

const formSchema = z
  .object({
    gameId: z.string().min(1, "Escolha o jogo"),
    hours: z.number().int().min(0).max(24),
    minutes: z.number().int().min(0).max(59),
    playedOn: isoDateSchema,
    note: z.string().max(500),
  })
  .refine((v) => v.hours * 60 + v.minutes >= 1, {
    message: "Informe quanto tempo jogou",
    path: ["minutes"],
  })
  .refine((v) => v.hours * 60 + v.minutes <= MAX_MINUTES_PER_DAY, {
    message: "Uma sessão vai até 24h",
    path: ["hours"],
  });

type FormValues = z.infer<typeof formSchema>;

const QUICK_ADD = [
  { label: "+15min", minutes: 15 },
  { label: "+30min", minutes: 30 },
  { label: "+1h", minutes: 60 },
];

interface SessionFormProps {
  editing: PlaySessionItem | null;
  initialGameId: number | null;
  onDone: () => void;
}

function SessionForm({ editing, initialGameId, onDone }: SessionFormProps) {
  const library = useQuery(libraryListQuery());
  const logSession = useLogSession();
  const updateSession = useUpdateSession();
  const [today] = useState(() => todayIn());
  const items = library.data?.items ?? [];

  // Padrão: jogo pedido > jogo da sessão editada > último "Jogando" jogado.
  const defaultGameId =
    initialGameId ?? editing?.gameId ?? items.find((i) => i.status === "playing")?.gameId;

  const form = useForm({
    defaultValues: {
      gameId: defaultGameId?.toString() ?? "",
      hours: editing ? Math.floor(editing.minutes / 60) : 0,
      minutes: editing ? editing.minutes % 60 : 0,
      playedOn: editing?.playedOn ?? today,
      note: editing?.note ?? "",
    } satisfies FormValues as FormValues,
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const minutes = value.hours * 60 + value.minutes;
      const note = value.note.trim();
      if (editing) {
        await updateSession.mutateAsync({
          id: editing.id,
          patch: { minutes, playedOn: value.playedOn, note: note || null },
        });
      } else {
        await logSession.mutateAsync({
          gameId: Number(value.gameId),
          minutes,
          playedOn: value.playedOn,
          ...(note && { note }),
        });
      }
      onDone();
    },
  });

  function addMinutes(extra: number) {
    const total = form.getFieldValue("hours") * 60 + form.getFieldValue("minutes") + extra;
    form.setFieldValue("hours", Math.min(24, Math.floor(total / 60)));
    form.setFieldValue("minutes", total % 60);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className="space-y-4"
    >
      <form.Field name="gameId">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Jogo</Label>
            <NativeSelect
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              disabled={Boolean(editing)}
              aria-invalid={field.state.meta.errors.length > 0}
            >
              <option value="" disabled>
                {library.isPending ? "Carregando…" : "Escolha o jogo"}
              </option>
              <GameOptions items={items} />
            </NativeSelect>
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>

      <div className="space-y-2">
        <Label>Duração</Label>
        <div className="flex items-center gap-2">
          <form.Field name="hours">
            {(field) => (
              <DurationInput
                label="horas"
                max={24}
                value={field.state.value}
                onChange={field.handleChange}
                invalid={field.state.meta.errors.length > 0}
              />
            )}
          </form.Field>
          <form.Field name="minutes">
            {(field) => (
              <DurationInput
                label="min"
                max={59}
                value={field.state.value}
                onChange={field.handleChange}
                invalid={field.state.meta.errors.length > 0}
              />
            )}
          </form.Field>
          <div className="ml-auto flex gap-1">
            {QUICK_ADD.map((q) => (
              <Button
                key={q.label}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addMinutes(q.minutes)}
              >
                {q.label}
              </Button>
            ))}
          </div>
        </div>
        <form.Subscribe
          selector={(s) => [
            ...(s.fieldMeta.hours?.errors ?? []),
            ...(s.fieldMeta.minutes?.errors ?? []),
          ]}
        >
          {(errors) => <FieldErrors errors={errors} />}
        </form.Subscribe>
      </div>

      <form.Field name="playedOn">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Dia</Label>
            <div className="flex gap-2">
              <Input
                id={field.name}
                type="date"
                max={today}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <Button type="button" variant="outline" onClick={() => field.handleChange(today)}>
                Hoje
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => field.handleChange(addDays(today, -1))}
              >
                Ontem
              </Button>
            </div>
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>

      <form.Field name="note">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Nota (opcional)</Label>
            <Textarea
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="Ex.: terminei o palácio 3"
              maxLength={500}
              className="min-h-16"
            />
          </div>
        )}
      </form.Field>

      <DialogFooter>
        <form.Subscribe
          selector={(s) => [s.isSubmitting, s.values.hours, s.values.minutes] as const}
        >
          {([isSubmitting, hours, minutes]) => (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? "Salvando…"
                : editing
                  ? "Salvar"
                  : `Registrar${hours * 60 + minutes > 0 ? ` ${formatMinutes(hours * 60 + minutes)}` : ""}`}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
}

/** Opções agrupadas por status, na ordem dos status (Jogando primeiro). */
function GameOptions({ items }: { items: LibraryItem[] }) {
  return gameStatuses.map((status) => {
    const group = items
      .filter((i) => i.status === status)
      .toSorted((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    if (group.length === 0) return null;
    return (
      <optgroup key={status} label={gameStatusLabels[status]}>
        {group.map((item) => (
          <option key={item.gameId} value={item.gameId}>
            {item.name}
          </option>
        ))}
      </optgroup>
    );
  });
}

interface DurationInputProps {
  label: string;
  max: number;
  value: number;
  onChange: (value: number) => void;
  invalid: boolean;
}

function DurationInput({ label, max, value, onChange, invalid }: DurationInputProps) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
        onFocus={(e) => e.target.select()}
        aria-invalid={invalid}
        className="w-16 text-center text-foreground"
      />
      {label}
    </label>
  );
}

function FieldErrors({ errors }: { errors: unknown[] }) {
  const messages = [
    ...new Set(
      errors
        .map((e) => (typeof e === "string" ? e : (e as { message?: string } | undefined)?.message))
        .filter(Boolean),
    ),
  ];
  if (messages.length === 0) return null;
  return <p className="text-sm text-destructive">{messages.join(" · ")}</p>;
}

import { useForm } from "@tanstack/react-form";
import { useId, useState } from "react";
import { todayIn } from "@shared/dates";
import { progressTargetLabels } from "@shared/completions";
import {
  type CompletionType,
  completionTypeLabels,
  type GameStatus,
  gameStatuses,
  gameStatusLabels,
} from "@shared/domain";
import {
  type LibraryItem,
  emulationTargets,
  MAX_PRIOR_MINUTES,
  priorMinutesSchema,
  storeSuggestions,
  subscriptionSuggestions,
  type UpdateLibraryEntryInput,
} from "@shared/library";
import { parseBrl } from "@shared/money";
import { DateInput, dateField } from "@/components/date-input";
import { DurationInput } from "@/components/duration-input";
import { FieldErrors } from "@/components/field-errors";
import { TimerIcon, TrashIcon } from "@/components/icons";
import { SessionsTable } from "@/components/sessions-table";
import { TimerButton } from "@/components/timer";
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
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/ui/native-select";
import { XpBar } from "@/components/ui/progress";
import { PlaytimeSourceControl } from "@/features/steam/playtime-source";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatHoursFromSeconds, formatMinutes, formatPercent } from "@/lib/format";
import { useRemoveFromLibrary, useUpdateLibraryEntry } from "@/lib/queries";
import { useLogSessionDialog } from "@/stores/log-session-dialog";
import { CompleteDialog, CompletionsSection } from "./completions-section";
import { ObjectivesSection } from "./objectives-section";

// Aba "Minhas sessões" da página do jogo: tempo jogado, sessões, detalhes da entrada e remover.

/** Só para jogos da biblioteca. Ao remover, a página continua aberta, já sem esta aba. */
export function MySessions({ item }: { item: LibraryItem }) {
  const openLogSession = useLogSessionDialog((state) => state.openNew);
  /** Diálogo "Marcar como zerado": fechado (null) ou aberto com o tipo já escolhido. */
  const [completeWith, setCompleteWith] = useState<CompletionType | null>(null);
  /** "Todos os objetivos concluídos. Marcar como 100%?" */
  const [suggestFull, setSuggestFull] = useState(false);

  return (
    <div className="space-y-6">
      <PlayedSummary item={item} />

      <CompletionsSection item={item} onMarkCompleted={() => setCompleteWith(nextLevel(item))} />
      <ObjectivesSection item={item} onAllDone={() => setSuggestFull(true)} />
      <CompleteDialog item={item} openWith={completeWith} onClose={() => setCompleteWith(null)} />
      <AlertDialog open={suggestFull} onOpenChange={setSuggestFull}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Todos os objetivos concluídos!</AlertDialogTitle>
            <AlertDialogDescription>Marcar {item.name} como 100%?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Agora não</AlertDialogCancel>
            <AlertDialogAction onClick={() => setCompleteWith("full")}>
              Marcar 100%
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="display-md">Sessões</h2>
          <div className="flex flex-wrap justify-end">
            <Button size="sm" variant="outline" onClick={() => openLogSession(item.gameId)}>
              <TimerIcon /> Registrar sessão
            </Button>
            <TimerButton gameId={item.gameId} size="sm" />
          </div>
        </div>
        <SessionsTable gameId={item.gameId} />
      </section>

      <section className="space-y-3">
        <h2 className="display-md">Detalhes</h2>
        <EntryForm key={item.updatedAt} item={item} />
      </section>

      <RemoveButton item={item} />
    </div>
  );
}

function PlayedSummary({ item }: { item: LibraryItem }) {
  const ttb = item.timeToBeat;
  const stats = [
    { label: "Jogado", value: formatMinutes(item.minutesPlayed) },
    { label: "História", value: ttb?.mainSec ? formatHoursFromSeconds(ttb.mainSec) : "—" },
    { label: "+ Extras", value: ttb?.extraSec ? formatHoursFromSeconds(ttb.extraSec) : "—" },
    { label: "100%", value: ttb?.completeSec ? formatHoursFromSeconds(ttb.completeSec) : "—" },
  ];

  return (
    <Card className="gap-3">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="display-xs text-muted-foreground">{s.label}</dt>
            <dd className="mt-2 display-sm tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
      {item.progress !== null && (
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <XpBar
              value={item.progress * 100}
              cells={20}
              tone={item.progress >= 1 ? "finished" : "primary"}
              label={`Progresso estimado ${progressTargetLabels[item.progressTarget]}`}
            />
            <span className="display-xs tabular-nums">{formatPercent(item.progress)}</span>
          </div>
          <p className="text-xs text-muted-foreground">{progressText(item, item.progress)}</p>
        </div>
      )}
      {item.playtimeSource === "sessions" && item.priorMinutes > 0 && (
        <p className="text-xs text-muted-foreground">
          {formatMinutes(item.priorMinutes)} antes do Zerômetro
          {item.sessionMinutes > 0 && ` + ${formatMinutes(item.sessionMinutes)} em sessões`}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {item.sessionsCount === 0
          ? "Nenhuma sessão registrada."
          : `${item.sessionsCount} ${item.sessionsCount === 1 ? "sessão" : "sessões"}` +
            (item.lastPlayedOn ? ` · última em ${formatDate(item.lastPlayedOn)}` : "")}
      </p>
      <PlaytimeSourceControl item={item} />
    </Card>
  );
}

interface EntryFormValues {
  status: GameStatus;
  rating: string;
  platformPlayed: string;
  /** "" = nativo, um de `emulationTargets` ou "outro" (com o texto em `emulatedOther`). */
  emulatedOn: string;
  emulatedOther: string;
  startedAt: string;
  notes: string;
  priorMinutes: number;
  acquiredOn: string;
  /** Como digitado ("59,90"); vira centavos no envio. */
  price: string;
  store: string;
  viaSubscription: boolean;
}

/** 5990 → "59,90" (o campo não leva o "R$"). */
const priceText = (cents: number | null) =>
  cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");

const OTHER_EMULATION = "outro";

function toFormValues(item: LibraryItem): EntryFormValues {
  const known = (emulationTargets as readonly string[]).includes(item.emulatedOn ?? "");
  return {
    status: item.status,
    rating: item.rating?.toString() ?? "",
    platformPlayed: item.platformPlayed ?? "",
    emulatedOn: item.emulatedOn === null ? "" : known ? item.emulatedOn : OTHER_EMULATION,
    emulatedOther: item.emulatedOn !== null && !known ? item.emulatedOn : "",
    startedAt: item.startedAt ?? "",
    notes: item.notes ?? "",
    priorMinutes: item.priorMinutes,
    acquiredOn: item.purchase?.acquiredOn ?? "",
    price: priceText(item.purchase?.pricePaidCents ?? null),
    store: item.purchase?.store ?? "",
    viaSubscription: item.purchase?.viaSubscription ?? false,
  };
}

const orNull = (v: string) => (v.trim() === "" ? null : v.trim());

/** O que vai para `emulatedOn`: a opção escolhida ou o texto de "Outro" (vazio = nativo). */
const emulatedValue = (v: EntryFormValues) =>
  v.emulatedOn === OTHER_EMULATION ? orNull(v.emulatedOther) : orNull(v.emulatedOn);

/** Só envia o que mudou; campos vazios viram null. */
function toPatch(values: EntryFormValues, initial: EntryFormValues): UpdateLibraryEntryInput {
  const patch: UpdateLibraryEntryInput = {};
  if (values.status !== initial.status) patch.status = values.status;
  if (values.rating !== initial.rating) patch.rating = values.rating ? Number(values.rating) : null;
  if (values.platformPlayed !== initial.platformPlayed)
    patch.platformPlayed = orNull(values.platformPlayed);
  if (emulatedValue(values) !== emulatedValue(initial)) patch.emulatedOn = emulatedValue(values);
  if (values.startedAt !== initial.startedAt) patch.startedAt = orNull(values.startedAt);
  if (values.notes !== initial.notes) patch.notes = orNull(values.notes);
  if (values.priorMinutes !== initial.priorMinutes) patch.priorMinutes = values.priorMinutes;
  if (values.acquiredOn !== initial.acquiredOn) patch.acquiredOn = orNull(values.acquiredOn);
  if (values.store !== initial.store) patch.store = orNull(values.store);
  if (values.viaSubscription !== initial.viaSubscription) {
    patch.viaSubscription = values.viaSubscription;
  }
  // Por assinatura não há preço: o servidor apaga o que houver.
  if (!values.viaSubscription && values.price !== initial.price) {
    patch.pricePaidCents = values.price.trim() === "" ? null : parseBrl(values.price);
  }
  return patch;
}

function EntryForm({ item }: { item: LibraryItem }) {
  const update = useUpdateLibraryEntry(item.gameId);
  const initial = toFormValues(item);
  // Limite dos campos de data; calculado uma vez por montagem do formulário.
  const [today] = useState(() => todayIn());
  // Plataforma registrada pode não estar na lista do IGDB (ex.: digitada pelo MCP).
  const platforms = [
    ...new Set([...item.platforms, ...(item.platformPlayed ? [item.platformPlayed] : [])]),
  ];

  const storeListId = useId();

  const form = useForm({
    defaultValues: initial,
    onSubmit: async ({ value }) => {
      const patch = toPatch(value, initial);
      if (Object.keys(patch).length > 0) await update.mutateAsync(patch);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <form.Field name="status">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Status</Label>
              <NativeSelect
                id={field.name}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value as GameStatus)}
              >
                {gameStatuses.map((s) => (
                  <option key={s} value={s}>
                    {gameStatusLabels[s]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </form.Field>

        <form.Field name="rating">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Nota</Label>
              <NativeSelect
                id={field.name}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              >
                <option value="">Sem nota</option>
                {Array.from({ length: 10 }, (_, i) => 10 - i).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </form.Field>

        <form.Field name="platformPlayed">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Plataforma</Label>
              <NativeSelect
                id={field.name}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              >
                <option value="">Não informada</option>
                {platforms.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </form.Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <form.Field
          name="startedAt"
          validators={{ onSubmit: dateField({ max: today, optional: true }) }}
        >
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Começou em</Label>
              <DateInput
                id={field.name}
                max={today}
                value={field.state.value}
                onChange={field.handleChange}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldErrors errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>

        <form.Field name="emulatedOn">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Emulado em</Label>
              <NativeSelect
                id={field.name}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              >
                <option value="">Não emulado</option>
                {emulationTargets.map((target) => (
                  <option key={target} value={target}>
                    {target}
                  </option>
                ))}
                <option value={OTHER_EMULATION}>Outro…</option>
              </NativeSelect>
            </div>
          )}
        </form.Field>

        <form.Subscribe selector={(state) => state.values.emulatedOn === OTHER_EMULATION}>
          {(other) =>
            other && (
              <form.Field name="emulatedOther">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Onde emula</Label>
                    <Input
                      id={field.name}
                      maxLength={50}
                      autoComplete="off"
                      placeholder="Retroid Pocket, iPhone…"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </div>
                )}
              </form.Field>
            )
          }
        </form.Subscribe>
      </div>

      <form.Field name="priorMinutes" validators={{ onSubmit: priorMinutesSchema }}>
        {(field) => (
          <div className="space-y-2">
            <Label>Antes do Zerômetro</Label>
            <p className="text-sm text-muted-foreground">
              Tempo que você já tinha jogado antes de registrar aqui. Conta no total e no progresso
              do jogo, mas não na ofensiva nem nas médias.
              {item.playtimeSource === "steam" &&
                " Agora o tempo do jogo vem da Steam: este valor fica guardado e volta a contar se você escolher as sessões."}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <DurationInput
                label="horas"
                max={MAX_PRIOR_MINUTES / 60}
                value={Math.floor(field.state.value / 60)}
                onChange={(h) => field.handleChange(h * 60 + (field.state.value % 60))}
                invalid={field.state.meta.errors.length > 0}
              />
              <DurationInput
                label="min"
                max={59}
                value={field.state.value % 60}
                onChange={(m) =>
                  field.handleChange(Math.floor(field.state.value / 60) * 60 + Math.min(m, 59))
                }
                invalid={field.state.meta.errors.length > 0}
              />
            </div>
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>

      <fieldset className="space-y-3">
        <legend className="display-xs text-muted-foreground">Compra</legend>
        <p className="text-sm text-muted-foreground">
          Para o comprei × zerei e o custo por hora nas Estatísticas. Fica só com você: o preço não
          entra no recap.
        </p>
        <form.Field name="viaSubscription">
          {(field) => (
            <div className="flex items-center gap-3">
              <Switch
                id={field.name}
                checked={field.state.value}
                onCheckedChange={field.handleChange}
              />
              <Label htmlFor={field.name}>Veio de assinatura (Game Pass, PS Plus…)</Label>
            </div>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.viaSubscription}>
          {(viaSubscription) => (
            <div className="grid gap-4 sm:grid-cols-3">
              <form.Field
                name="acquiredOn"
                validators={{ onSubmit: dateField({ max: today, optional: true }) }}
              >
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>
                      {viaSubscription ? "Resgatou em" : "Comprou em"}
                    </Label>
                    <DateInput
                      id={field.name}
                      max={today}
                      value={field.state.value}
                      onChange={field.handleChange}
                      aria-invalid={field.state.meta.errors.length > 0}
                    />
                    <FieldErrors errors={field.state.meta.errors} />
                  </div>
                )}
              </form.Field>

              {!viaSubscription && (
                <form.Field
                  name="price"
                  validators={{
                    onSubmit: ({ value }) =>
                      value.trim() === "" || parseBrl(value) !== null
                        ? undefined
                        : "Preço inválido: use 59,90 (até R$ 99.999,99)",
                  }}
                >
                  {(field) => (
                    <div className="space-y-2">
                      <Label htmlFor={field.name}>Preço pago (R$)</Label>
                      <Input
                        id={field.name}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0,00"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        aria-invalid={field.state.meta.errors.length > 0}
                      />
                      <FieldErrors errors={field.state.meta.errors} />
                    </div>
                  )}
                </form.Field>
              )}

              <form.Field name="store">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>{viaSubscription ? "Assinatura" : "Loja"}</Label>
                    <Input
                      id={field.name}
                      list={storeListId}
                      maxLength={50}
                      autoComplete="off"
                      placeholder={viaSubscription ? "Game Pass" : "Steam"}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <datalist id={storeListId}>
                      {(viaSubscription ? subscriptionSuggestions : storeSuggestions).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </datalist>
                  </div>
                )}
              </form.Field>
            </div>
          )}
        </form.Subscribe>
      </fieldset>

      <form.Field name="notes">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Anotações</Label>
            <Textarea
              id={field.name}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="Impressões, onde parei, conquistas…"
              maxLength={2000}
            />
          </div>
        )}
      </form.Field>

      <form.Subscribe selector={(s) => [s.isDirty, s.isSubmitting] as const}>
        {([isDirty, isSubmitting]) => (
          <div className="flex flex-wrap">
            <Button type="submit" disabled={!isDirty || isSubmitting}>
              {isSubmitting ? "Salvando…" : "Salvar"}
            </Button>
            {isDirty && (
              <Button type="button" variant="ghost" onClick={() => form.reset()}>
                Descartar
              </Button>
            )}
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}

function RemoveButton({ item }: { item: LibraryItem }) {
  const remove = useRemoveFromLibrary();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
          <TrashIcon /> Remover da biblioteca
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover {item.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {removalText(item)}
            Não dá para desfazer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => remove.mutate(item.gameId)}>Remover</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** O que a barra de progresso mede: a história antes de zerar, depois o próximo nível. */
function progressText(item: LibraryItem, progress: number): string {
  const { completion, progressTarget } = item;
  // Já zerou e o IGDB não tem tempo do próximo nível: a barra fica cheia no nível alcançado.
  if (completion && progressTarget === completion.best) {
    return completion.best === "full"
      ? "Concluído 100%"
      : `${completionTypeLabels[completion.best]} concluída (o IGDB não tem tempo do próximo nível)`;
  }
  return `${formatPercent(progress)} ${progressTargetLabels[progressTarget]} (estimativa pelo tempo do IGDB)`;
}

/** "Também apaga 8 sessões (13h 55min), 2 conclusões e 3 objetivos." */
function removalText(item: LibraryItem): string {
  const parts = [
    item.sessionsCount > 0 &&
      `${plural(item.sessionsCount, "sessão", "sessões")} (${formatMinutes(item.minutesPlayed)})`,
    item.completion && plural(item.completion.count, "conclusão", "conclusões"),
    item.objectives && plural(item.objectives.total, "objetivo", "objetivos"),
  ].filter(Boolean);
  if (parts.length === 0) return "";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}`;
  return `Também apaga ${list}. `;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** O diálogo abre no próximo nível: história, depois + extras, depois 100%. */
function nextLevel(item: LibraryItem): CompletionType {
  const best = item.completion?.best;
  return best === "main" ? "extras" : best ? "full" : "main";
}

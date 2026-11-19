import { useForm } from "@tanstack/react-form";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { todayIn } from "@shared/dates";
import { type GameStatus, gameStatuses, gameStatusLabels } from "@shared/domain";
import type { LibraryItem, UpdateLibraryEntryInput } from "@shared/library";
import { GameCover } from "@/components/game-cover";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { formatDate, formatHoursFromSeconds, formatMinutes, formatPercent } from "@/lib/format";
import { libraryItemQuery, useRemoveFromLibrary, useUpdateLibraryEntry } from "@/lib/queries";

export const Route = createFileRoute("/jogos/$gameId")({
  params: {
    parse: (raw) => ({ gameId: z.coerce.number().int().positive().parse(raw.gameId) }),
    stringify: ({ gameId }) => ({ gameId: String(gameId) }),
  },
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(libraryItemQuery(params.gameId)),
  component: GamePage,
  errorComponent: ({ error }) => (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        {error instanceof ApiError && error.status === 404
          ? "Esse jogo não está na biblioteca."
          : "Não foi possível carregar o jogo."}
      </p>
      <Button asChild variant="outline">
        <Link to="/biblioteca">Voltar para a biblioteca</Link>
      </Button>
    </div>
  ),
});

function GamePage() {
  const { gameId } = Route.useParams();
  const { data: item } = useSuspenseQuery(libraryItemQuery(gameId));

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link to="/biblioteca">
          <ArrowLeft /> Biblioteca
        </Link>
      </Button>

      <div className="grid gap-8 md:grid-cols-[220px_1fr]">
        <div className="mx-auto w-44 md:w-full">
          <GameCover name={item.name} imageId={item.coverImageId} size="720p" />
        </div>

        <div className="space-y-6">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">{item.name}</h1>
            <p className="text-sm text-muted-foreground">
              {[item.releaseYear, ...item.genres].filter(Boolean).join(" · ")}
            </p>
            <div className="flex flex-wrap gap-1">
              {item.platforms.map((p) => (
                <Badge key={p} variant="outline">
                  {p}
                </Badge>
              ))}
            </div>
          </header>

          <PlayedSummary item={item} />
          <EntryForm key={item.updatedAt} item={item} />
          <RemoveButton item={item} />
        </div>
      </div>
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
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
      {item.progress !== null && (
        <div className="space-y-1">
          <Progress value={item.progress * 100} />
          <p className="text-xs text-muted-foreground">
            {formatPercent(item.progress)} da história (estimativa pelo tempo do IGDB)
          </p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {item.sessionsCount === 0
          ? "Nenhuma sessão registrada."
          : `${item.sessionsCount} ${item.sessionsCount === 1 ? "sessão" : "sessões"}` +
            (item.lastPlayedOn ? ` · última em ${formatDate(item.lastPlayedOn)}` : "")}
      </p>
    </Card>
  );
}

interface EntryFormValues {
  status: GameStatus;
  rating: string;
  platformPlayed: string;
  startedAt: string;
  finishedAt: string;
  notes: string;
}

function toFormValues(item: LibraryItem): EntryFormValues {
  return {
    status: item.status,
    rating: item.rating?.toString() ?? "",
    platformPlayed: item.platformPlayed ?? "",
    startedAt: item.startedAt ?? "",
    finishedAt: item.finishedAt ?? "",
    notes: item.notes ?? "",
  };
}

const orNull = (v: string) => (v.trim() === "" ? null : v.trim());

/** Só envia o que mudou; campos vazios viram null. */
function toPatch(values: EntryFormValues, initial: EntryFormValues): UpdateLibraryEntryInput {
  const patch: UpdateLibraryEntryInput = {};
  if (values.status !== initial.status) patch.status = values.status;
  if (values.rating !== initial.rating) patch.rating = values.rating ? Number(values.rating) : null;
  if (values.platformPlayed !== initial.platformPlayed)
    patch.platformPlayed = orNull(values.platformPlayed);
  if (values.startedAt !== initial.startedAt) patch.startedAt = orNull(values.startedAt);
  if (values.status === "finished" && values.finishedAt !== initial.finishedAt)
    patch.finishedAt = orNull(values.finishedAt);
  if (values.notes !== initial.notes) patch.notes = orNull(values.notes);
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
        <form.Field name="startedAt">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Começou em</Label>
              <Input
                id={field.name}
                type="date"
                max={today}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>

        <form.Subscribe selector={(s) => s.values.status}>
          {(status) =>
            status === "finished" && (
              <form.Field name="finishedAt">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Zerou em</Label>
                    <Input
                      id={field.name}
                      type="date"
                      max={today}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="Hoje"
                    />
                  </div>
                )}
              </form.Field>
            )
          }
        </form.Subscribe>
      </div>

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
          <div className="flex gap-2">
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
  const navigate = useNavigate();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
          <Trash2 /> Remover da biblioteca
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover {item.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {item.sessionsCount > 0
              ? `As ${item.sessionsCount} sessões registradas (${formatMinutes(item.minutesPlayed)}) também serão apagadas. `
              : ""}
            Não dá para desfazer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              remove.mutate(item.gameId, {
                onSuccess: () => navigate({ to: "/biblioteca" }),
              })
            }
          >
            Remover
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

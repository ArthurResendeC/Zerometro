import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type GameStatus, gameStatuses, gameStatusLabels } from "@shared/domain";
import type { SteamImportCandidate, SteamImportPreview } from "@shared/steam";
import { GameCover } from "@/components/game-cover";
import { CheckIcon, SearchIcon } from "@/components/icons";
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
import { NativeSelect } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatMinutes } from "@/lib/format";
import {
  type SteamImportProgress,
  steamImportPreviewQuery,
  useImportSteamGames,
} from "@/lib/queries";
import { cn, normalizeForSearch } from "@/lib/utils";

/**
 * "Importar da Steam": os jogos da conta que ainda não estão na biblioteca. Vêm marcados os que
 * têm horas (e não foram ignorados antes); o que ficar desmarcado vira ignorado. Depois de
 * importar, as conquistas e as horas vêm em lotes, com a barra de progresso.
 */
export function SteamImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const importGames = useImportSteamGames();
  const [progress, setProgress] = useState<SteamImportProgress | null>(null);
  const busy = importGames.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // No meio da importação não fecha: os lotes de conquistas ainda estão indo.
        if (!busy) onOpenChange(next);
      }}
    >
      {/* Coluna flex: cabeçalho, filtros e rodapé fixos; só a lista rola. Numa tela baixa a lista
          encolhe para o diálogo caber. */}
      <DialogContent className="flex flex-col sm:max-w-[720px]" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>Importar da Steam</DialogTitle>
          {/* No celular a lista precisa do espaço; a descrição fica só para leitores de tela. */}
          <DialogDescription className="max-sm:sr-only">
            Os jogos da sua conta que ainda não estão aqui. Eles entram com o tempo da Steam, e as
            conquistas vêm junto.
          </DialogDescription>
        </DialogHeader>
        {busy ? (
          <ImportProgress progress={progress} />
        ) : (
          <PreviewBody
            onSubmit={(input) => {
              setProgress(null);
              importGames.mutate(
                { input, onProgress: setProgress },
                { onSuccess: () => onOpenChange(false) },
              );
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportProgress({ progress }: { progress: SteamImportProgress | null }) {
  const text = !progress
    ? "Adicionando os jogos…"
    : `Buscando conquistas e horas: ${progress.done} de ${progress.total}`;
  const value = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
  return (
    <div className="space-y-2 py-4">
      <output className="block text-sm" aria-live="polite">
        {text}
      </output>
      <Progress value={value} aria-label="Progresso da importação" />
      <p className="text-xs text-muted-foreground">
        Pode levar alguns minutos com muitos jogos. Deixe esta tela aberta até terminar.
      </p>
    </div>
  );
}

type SubmitInput = {
  games: { appId: number; status: GameStatus }[];
  ignore: number[];
};

function PreviewBody({ onSubmit }: { onSubmit: (input: SubmitInput) => void }) {
  const { data, error, isPending, refetch } = useQuery({
    ...steamImportPreviewQuery(),
    // Sem recarregar enquanto a pessoa escolhe.
    refetchOnWindowFocus: false,
  });

  if (isPending) {
    return (
      <div className="space-y-2" aria-label="Carregando os jogos da Steam">
        <p className="text-sm text-muted-foreground">Lendo a sua conta Steam e buscando no IGDB…</p>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{error.message}</p>
        <Button variant="secondary" onClick={() => void refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  }
  return <ImportForm preview={data} onSubmit={onSubmit} />;
}

/** Marcados no começo: os que têm horas e não foram ignorados, com o status sugerido. */
function initialSelection(preview: SteamImportPreview): Map<number, GameStatus> {
  return new Map(
    preview.candidates
      .filter((c) => !c.ignored && c.minutes > 0)
      .map((c) => [c.appId, c.suggestedStatus]),
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ImportForm({
  preview,
  onSubmit,
}: {
  preview: SteamImportPreview;
  onSubmit: (input: SubmitInput) => void;
}) {
  const [selection, setSelection] = useState(() => initialSelection(preview));
  const [showIgnored, setShowIgnored] = useState(false);
  const [query, setQuery] = useState("");

  const { candidates, unmatched, inLibrary, hidesPlaytime } = preview;
  const ignoredCount = candidates.filter((c) => c.ignored).length;
  const term = normalizeForSearch(query.trim());
  const visible = candidates.filter(
    (c) =>
      (showIgnored || !c.ignored || selection.has(c.appId)) &&
      (!term || normalizeForSearch(`${c.name} ${c.steamName ?? ""}`).includes(term)),
  );

  const update = (change: (next: Map<number, GameStatus>) => void) =>
    setSelection((current) => {
      const next = new Map(current);
      change(next);
      return next;
    });
  const toggle = (c: SteamImportCandidate, on: boolean) =>
    update((next) => (on ? next.set(c.appId, c.suggestedStatus) : next.delete(c.appId)));
  const selectWhere = (keep: (c: SteamImportCandidate) => boolean) =>
    update((next) => {
      for (const c of visible) {
        if (keep(c)) next.set(c.appId, next.get(c.appId) ?? c.suggestedStatus);
        else next.delete(c.appId);
      }
    });

  const submit = () =>
    onSubmit({
      games: candidates.flatMap((c) => {
        const status = selection.get(c.appId);
        return status ? [{ appId: c.appId, status }] : [];
      }),
      ignore: candidates.filter((c) => !selection.has(c.appId)).map((c) => c.appId),
    });

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-4">
      <p className="text-sm">
        {candidates.length === 0
          ? "Todos os jogos da sua conta que o IGDB conhece já estão na biblioteca."
          : plural(candidates.length, "jogo fora da biblioteca", "jogos fora da biblioteca")}
        {ignoredCount > 0 && ` (${plural(ignoredCount, "ignorado", "ignorados")})`}
        {inLibrary > 0 && ` · ${inLibrary} já ${inLibrary === 1 ? "está" : "estão"} aqui`}
      </p>
      {hidesPlaytime && candidates.length > 0 && (
        <p className="text-sm text-muted-foreground">
          A sua Steam esconde o tempo de jogo, então nada veio marcado. Marque os que quiser, ou em
          Privacidade desmarque "Sempre manter meu tempo total de jogo privado".
        </p>
      )}

      {candidates.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtrar pelo nome"
                aria-label="Filtrar pelo nome"
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {!hidesPlaytime && (
                <Button size="sm" variant="ghost" onClick={() => selectWhere((c) => c.minutes > 0)}>
                  Com horas
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => selectWhere(() => true)}>
                Todos
              </Button>
              <Button size="sm" variant="ghost" onClick={() => selectWhere(() => false)}>
                Nenhum
              </Button>
            </div>
          </div>

          <ul
            className="max-h-[min(20rem,40dvh)] min-h-20 min-w-0 flex-1 divide-y-(length:--rule) divide-border overflow-y-auto pr-1"
            aria-label="Jogos da Steam"
          >
            {visible.map((c) => (
              <CandidateRow
                key={c.appId}
                candidate={c}
                status={selection.get(c.appId) ?? null}
                hidesPlaytime={hidesPlaytime}
                onToggle={(on) => toggle(c, on)}
                onStatus={(status) => update((next) => next.set(c.appId, status))}
              />
            ))}
            {visible.length === 0 && (
              <li className="py-4 text-sm text-muted-foreground">
                {term
                  ? "Nenhum jogo com esse nome."
                  : "Os que faltam estão nos ignorados. Mostre-os abaixo para escolher algum."}
              </li>
            )}
          </ul>

          {ignoredCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => setShowIgnored((v) => !v)}
            >
              {showIgnored
                ? "Esconder os ignorados"
                : `Mostrar os ${ignoredCount} ignorado${ignoredCount === 1 ? "" : "s"}`}
            </Button>
          )}
        </>
      )}

      {unmatched.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {unmatched.length} {unmatched.length === 1 ? "item" : "itens"} da conta que o IGDB não
            conhece
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            Costumam ser ferramentas, trilhas sonoras ou testes. Se algum for jogo, adicione pela
            busca.
          </p>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1">
            {unmatched.map((u) => (
              <li key={u.appId} className="flex justify-between gap-2">
                <span className="truncate">{u.name ?? `App ${u.appId}`}</span>
                {u.minutes > 0 && (
                  <span className="shrink-0 text-muted-foreground">{formatMinutes(u.minutes)}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {candidates.length > 0 && (
        <DialogFooter className="items-center gap-y-2">
          <p className="text-xs text-muted-foreground sm:mr-auto">
            Os desmarcados ficam ignorados e não vêm marcados da próxima vez.
          </p>
          <Button onClick={submit} disabled={selection.size === 0}>
            {selection.size === 0
              ? "Marque algum jogo"
              : `Importar ${selection.size} ${selection.size === 1 ? "jogo" : "jogos"}`}
          </Button>
        </DialogFooter>
      )}
    </div>
  );
}

function CandidateRow({
  candidate: c,
  status,
  hidesPlaytime,
  onToggle,
  onStatus,
}: {
  candidate: SteamImportCandidate;
  status: GameStatus | null;
  hidesPlaytime: boolean;
  onToggle: (on: boolean) => void;
  onStatus: (status: GameStatus) => void;
}) {
  const checked = status !== null;
  const meta = [
    c.minutes > 0 ? `${formatMinutes(c.minutes)} na Steam` : hidesPlaytime ? null : "Nunca jogado",
    c.lastPlayedAt
      ? `jogou em ${formatDate(c.lastPlayedAt.slice(0, 10))}`
      : c.recentMinutes > 0 && "jogou nas últimas 2 semanas",
    c.releaseYear,
    c.ignored && "ignorado",
  ].filter(Boolean);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
      {/* relative: o checkbox sr-only é absolute; sem isso ele se posiciona no diálogo e estica a
          rolagem dele com espaço vazio. */}
      <label className="relative flex min-w-0 flex-1 basis-60 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={c.name}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={cn(
            "m-0.5 grid size-6 shrink-0 place-items-center pixel-frame-thin peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-focus-visible:outline-solid [&_svg]:size-3",
            checked
              ? "bg-status-finished text-status-finished-foreground [--px-frame-color:var(--status-finished)]"
              : "bg-background",
          )}
        >
          {checked && <CheckIcon />}
        </span>
        <GameCover name={c.name} imageId={c.coverImageId} size="thumb" className="w-10 shrink-0" />
        <span className="min-w-0">
          <span className="block truncate">{c.name}</span>
          {c.steamName && (
            <span className="block truncate text-xs text-muted-foreground">
              Na Steam: {c.steamName}
            </span>
          )}
          <span className="block truncate text-xs text-muted-foreground">{meta.join(" · ")}</span>
        </span>
      </label>
      {checked && (
        <NativeSelect
          aria-label={`Status de ${c.name}`}
          value={status}
          onChange={(e) => onStatus(e.target.value as GameStatus)}
          className="h-9 w-full sm:w-40"
        >
          {gameStatuses.map((s) => (
            <option key={s} value={s}>
              {gameStatusLabels[s]}
            </option>
          ))}
        </NativeSelect>
      )}
    </li>
  );
}

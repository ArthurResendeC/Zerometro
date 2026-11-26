import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { type LibraryItem, sortLibraryItems } from "@shared/library";
import { GameCover } from "@/components/game-cover";
import { ListIcon, PlayIcon, PlusIcon, SearchIcon, StarIcon } from "@/components/icons";
import { type SegmentedOption, SegmentedToggle } from "@/components/segmented-toggle";
import { StatusBadge } from "@/components/status-badge";
import { useActiveTimer } from "@/components/timer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import { SuggestPanel } from "@/features/suggest/suggest-panel";
import { libraryListQuery, useStartTimer } from "@/lib/queries";
import { cn, normalizeForSearch } from "@/lib/utils";

type PickerTab = "escolher" | "sugerir";

const tabOptions: SegmentedOption<PickerTab>[] = [
  { value: "escolher", label: "Escolher", Icon: ListIcon },
  { value: "sugerir", label: "Me sugere", Icon: StarIcon },
];

/**
 * Botão "Jogar" do cabeçalho: escolhe um jogo da biblioteca (ou pede uma sugestão pelo tempo e
 * pelo clima) e liga o timer dele.
 */
export function StartSessionButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PickerTab>("escolher");

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label="Começar a jogar"
        className={className}
      >
        <PlayIcon />
        <span className="hidden xl:inline">Jogar</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Começar a jogar</DialogTitle>
            <DialogDescription>
              {tab === "escolher"
                ? "Escolha o jogo e o timer começa a contar."
                : "Diga quanto tempo você tem e o clima: o Zerômetro sugere (ou sorteia)."}
            </DialogDescription>
          </DialogHeader>
          <SegmentedToggle
            legend="Como escolher"
            options={tabOptions}
            value={tab}
            onChange={setTab}
            className="justify-self-start"
          />
          {/* Desmonta ao fechar: a busca sempre abre vazia. */}
          {open && tab === "escolher" && <GamePicker onDone={() => setOpen(false)} />}
          {open && tab === "sugerir" && <SuggestTab onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Jogando primeiro; depois o resto pela última sessão (quem nunca jogou vai para o fim). */
function pickerOrder(items: readonly LibraryItem[]): LibraryItem[] {
  const sorted = sortLibraryItems(items, "last_session");
  return [
    ...sorted.filter((i) => i.status === "playing"),
    ...sorted.filter((i) => i.status !== "playing"),
  ];
}

/** Liga o timer do jogo escolhido e fecha o diálogo. */
function usePlay(onDone: () => void) {
  const { active } = useActiveTimer();
  const start = useStartTimer();
  const play = (gameId: number) => {
    // Já está rodando: nada a fazer além de fechar.
    if (active?.gameId !== gameId) {
      // A escolha aqui é explícita (o aviso diz que troca), então não pergunta de novo.
      start.mutate({ gameId, ...(active && { replaceActive: true }) });
    }
    onDone();
  };
  return { play, active, isPending: start.isPending };
}

function SuggestTab({ onDone }: { onDone: () => void }) {
  const { play, active, isPending } = usePlay(onDone);
  return (
    <div className="grid min-w-0 gap-3">
      <SuggestPanel onPlay={play} disabled={isPending} />
      {active && (
        <p className="text-xs text-muted-foreground">
          O timer de {active.gameName} está ligado: jogar outro encerra e salva essa sessão.
        </p>
      )}
    </div>
  );
}

function GamePicker({ onDone }: { onDone: () => void }) {
  const library = useQuery(libraryListQuery());
  const { play: playGame, active, isPending } = usePlay(onDone);
  const [query, setQuery] = useState("");

  const items = library.data?.items ?? [];
  const term = normalizeForSearch(query.trim());
  const visible = pickerOrder(items).filter(
    (i) => !term || normalizeForSearch(i.name).includes(term),
  );

  const play = (item: LibraryItem) => playGame(item.gameId);

  if (library.isPending) return <p className="text-muted-foreground">Carregando…</p>;

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground">Sua biblioteca está vazia.</p>
        <AddGameLink onClick={onDone} />
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-3">
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          // Enter joga o primeiro da lista filtrada.
          if (visible[0]) play(visible[0]);
        }}
      >
        <SearchIcon className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar na biblioteca"
          aria-label="Buscar na biblioteca"
          className="pl-10"
        />
      </form>

      {active && (
        <p className="text-xs text-muted-foreground">
          O timer de {active.gameName} está ligado: escolher outro jogo encerra e salva essa sessão.
        </p>
      )}

      {visible.length === 0 ? (
        <p className="py-4 text-muted-foreground">Nenhum jogo com esse nome na biblioteca.</p>
      ) : (
        <ul className="-mx-2 max-h-[min(24rem,55dvh)] overflow-y-auto px-2 py-1">
          {visible.map((item) => {
            const running = active?.gameId === item.gameId;
            return (
              <li key={item.gameId}>
                <button
                  type="button"
                  onClick={() => play(item)}
                  disabled={isPending}
                  className={cn(
                    "group flex w-full cursor-pointer items-center gap-3 p-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default",
                    running && "bg-accent",
                  )}
                >
                  <GameCover
                    name={item.name}
                    imageId={item.coverImageId}
                    size="thumb"
                    className="w-8 shrink-0"
                  />
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="truncate">{item.name}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <StatusBadge status={item.displayState} />
                      {running
                        ? "Jogando agora"
                        : item.lastPlayedOn && `Última sessão ${formatDate(item.lastPlayedOn)}`}
                    </span>
                  </span>
                  <PlayIcon
                    aria-hidden
                    className={cn(
                      "shrink-0 text-primary",
                      !running && "invisible group-hover:visible group-focus-visible:visible",
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t-2 border-dashed border-muted pt-3">
        <AddGameLink onClick={onDone} variant="ghost" />
      </div>
    </div>
  );
}

function AddGameLink({
  onClick,
  variant = "default",
}: {
  onClick: () => void;
  variant?: "default" | "ghost";
}) {
  return (
    <Button asChild size="sm" variant={variant}>
      <Link to="/adicionar" onClick={onClick}>
        <PlusIcon /> Adicionar jogo
      </Link>
    </Button>
  );
}

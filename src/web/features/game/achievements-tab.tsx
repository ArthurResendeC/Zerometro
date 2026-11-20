import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useDeferredValue, useState } from "react";
import {
  type AchievementItem,
  type AchievementSetCandidate,
  type AchievementSetItem,
  type AchievementSource,
  type AchievementsSummary,
  achievementSourceLabels,
  achievementSources,
} from "@shared/achievements";
import { DEFAULT_TIME_ZONE, zonedParts } from "@shared/dates";
import type { CompletionType } from "@shared/domain";
import type { LibraryItem } from "@shared/library";
import { RA_CONSOLES } from "@shared/ra-consoles";
import { ExternalLink } from "@/components/external-link";
import {
  CheckIcon,
  DownloadIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  TrophyIcon,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { XpBar } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatPercent } from "@/lib/format";
import {
  type AchievementChange,
  achievementCandidatesQuery,
  achievementsQuery,
  steamProfileQuery,
  useAchievementChange,
  useLinkAchievementSet,
  useRefreshAchievements,
  useSyncSteamGame,
  useUnlinkAchievementSet,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import { CompleteDialog } from "./completions-section";

// Aba "Conquistas" da página do jogo: as listas da Steam e do RetroAchievements que o jogo
// segue, marcadas à mão. As listas (nomes, ícones, raridade) vêm da fonte e são só leitura.

const filters = { all: "Todas", missing: "Faltando", unlocked: "Desbloqueadas" } as const;
type Filter = keyof typeof filters;
const sorts = {
  source: "Ordem da lista",
  rarest: "Mais raras primeiro",
  common: "Mais comuns primeiro",
} as const;
type Sort = keyof typeof sorts;
/** Listas grandes (300+) aparecem aos poucos. */
const PAGE_SIZE = 60;

export function AchievementsTab({ item }: { item: LibraryItem }) {
  const { data } = useQuery(achievementsQuery(item.gameId));
  const change = useAchievementChange(item.gameId);
  const refresh = useRefreshAchievements(item.gameId);
  const { data: steamProfile } = useQuery(steamProfileQuery());
  const steamSync = useSyncSteamGame(item.gameId);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("source");
  const [linking, setLinking] = useState(false);
  const [suggestFull, setSuggestFull] = useState(false);
  const [completeWith, setCompleteWith] = useState<CompletionType | null>(null);

  const apply = (next: AchievementChange) =>
    change.mutate(next, {
      onSuccess: (result) => result.suggestFullCompletion && setSuggestFull(true),
    });

  if (!data) {
    return (
      <div className="space-y-3" aria-busy>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const anySource = achievementSources.some((s) => data.sources[s]);
  // Sincronizar faz sentido com o perfil conectado e uma lista da Steam ligada (ou nenhuma lista:
  // a sincronização liga a da Steam se o jogo estiver na conta).
  const canSyncSteam =
    Boolean(steamProfile?.profile) &&
    (data.sets.length === 0 || data.sets.some((s) => s.source === "steam"));
  if (!anySource && data.sets.length === 0) return <NotConfigured />;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="display-md">Conquistas</h2>
          {data.sets.length > 0 && (
            <div className="flex flex-wrap justify-end">
              {canSyncSteam && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={steamSync.isPending}
                  onClick={() => steamSync.mutate()}
                >
                  <DownloadIcon />{" "}
                  {steamSync.isPending ? (
                    "Sincronizando…"
                  ) : (
                    <>
                      Sincronizar<span className="hidden sm:inline"> com a Steam</span>
                    </>
                  )}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={refresh.isPending}
                onClick={() => refresh.mutate()}
              >
                Atualizar listas
              </Button>
              {anySource && (
                <Button size="sm" variant="outline" onClick={() => setLinking(true)}>
                  <PlusIcon /> Ligar outra lista
                </Button>
              )}
            </div>
          )}
        </div>

        {data.summary ? (
          <Overview summary={data.summary} />
        ) : (
          <Card className="gap-4">
            <p className="text-sm text-muted-foreground">
              Ligue a lista de conquistas da Steam ou do RetroAchievements e marque o que já
              conseguiu. Os nomes, ícones e a raridade vêm da fonte.
            </p>
            {canSyncSteam && (
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={steamSync.isPending} onClick={() => steamSync.mutate()}>
                  <DownloadIcon />{" "}
                  {steamSync.isPending ? "Sincronizando…" : "Sincronizar com a Steam"}
                </Button>
                <p className="text-sm text-muted-foreground">
                  Liga a lista da Steam e traz o que você já desbloqueou na sua conta.
                </p>
              </div>
            )}
            <SetPicker item={item} sources={data.sources} />
          </Card>
        )}
      </section>

      {data.sets.length > 0 && (
        <>
          <Toolbar
            filter={filter}
            onFilter={setFilter}
            search={search}
            onSearch={setSearch}
            sort={sort}
            onSort={setSort}
          />
          {data.sets.map((set) => (
            <SetCard
              key={set.id}
              gameId={item.gameId}
              set={set}
              filter={filter}
              search={search}
              sort={sort}
              onChange={apply}
            />
          ))}
        </>
      )}

      <Credits sets={data.sets} />

      <Dialog open={linking} onOpenChange={setLinking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ligar lista de conquistas</DialogTitle>
            <DialogDescription>{item.name}</DialogDescription>
          </DialogHeader>
          {linking && (
            <SetPicker item={item} sources={data.sources} onLinked={() => setLinking(false)} />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={suggestFull} onOpenChange={setSuggestFull}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Todas as conquistas desbloqueadas!</AlertDialogTitle>
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
      <CompleteDialog item={item} openWith={completeWith} onClose={() => setCompleteWith(null)} />
    </div>
  );
}

function NotConfigured() {
  return (
    <section className="space-y-3">
      <h2 className="display-md">Conquistas</h2>
      <Card>
        <p className="text-sm text-muted-foreground">
          As conquistas da Steam e do RetroAchievements não estão configuradas neste servidor.
          Defina <code>STEAM_WEB_API_KEY</code> e/ou <code>RA_API_KEY</code> (veja o README).
          Enquanto isso, dá para acompanhar o que falta em <b>Objetivos</b>, na aba de sessões.
        </p>
      </Card>
    </section>
  );
}

function Overview({ summary }: { summary: AchievementsSummary }) {
  const { total, unlocked, points, pointsUnlocked } = summary;
  const ratio = total > 0 ? unlocked / total : 0;
  return (
    <Card className="gap-2">
      <div className="flex items-center gap-3">
        <XpBar
          value={ratio * 100}
          cells={20}
          tone={total > 0 && unlocked === total ? "finished" : "info"}
          label="Conquistas desbloqueadas"
        />
        <span className="display-xs whitespace-nowrap tabular-nums">
          {unlocked}/{total} · {formatPercent(ratio)}
        </span>
      </div>
      {points > 0 && (
        <p className="text-xs text-muted-foreground tabular-nums">
          {pointsUnlocked} de {points} pontos no RetroAchievements
        </p>
      )}
    </Card>
  );
}

interface ToolbarProps {
  filter: Filter;
  onFilter: (filter: Filter) => void;
  search: string;
  onSearch: (search: string) => void;
  sort: Sort;
  onSort: (sort: Sort) => void;
}

function Toolbar({ filter, onFilter, search, onSearch, sort, onSort }: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <fieldset className="inline-flex bg-background pixel-frame-thin">
        <legend className="sr-only">Mostrar</legend>
        {(Object.keys(filters) as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => onFilter(f)}
            className={cn(
              "h-9 cursor-pointer px-3 display-xs",
              filter === f
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {filters[f]}
          </button>
        ))}
      </fieldset>
      <div className="relative min-w-0 flex-1 basis-48">
        <Input
          aria-label="Buscar conquista"
          placeholder="Buscar conquista"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="h-10 pl-9"
        />
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
      </div>
      <NativeSelect
        aria-label="Ordenar"
        value={sort}
        onChange={(e) => onSort(e.target.value as Sort)}
        className="h-10 w-auto"
      >
        {(Object.keys(sorts) as Sort[]).map((s) => (
          <option key={s} value={s}>
            {sorts[s]}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

function visible(set: AchievementSetItem, filter: Filter, search: string, sort: Sort) {
  const term = normalize(search.trim());
  const list = set.achievements.filter((a) => {
    if (filter === "missing" && a.unlockedAt) return false;
    if (filter === "unlocked" && !a.unlockedAt) return false;
    // Secretas ainda trancadas não entram na busca pelo texto (seria spoiler).
    if (term && !(a.hidden && !a.unlockedAt)) {
      return normalize(`${a.title} ${a.description ?? ""}`).includes(term);
    }
    return !term;
  });
  if (sort === "source") return list;
  const rarity = (a: AchievementItem) => a.rarity ?? (sort === "rarest" ? Infinity : -Infinity);
  return list.toSorted((a, b) =>
    sort === "rarest" ? rarity(a) - rarity(b) : rarity(b) - rarity(a),
  );
}

interface SetCardProps {
  gameId: number;
  set: AchievementSetItem;
  filter: Filter;
  search: string;
  sort: Sort;
  onChange: (change: AchievementChange) => void;
}

function SetCard({ gameId, set, filter, search, sort, onChange }: SetCardProps) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const deferredSearch = useDeferredValue(search);
  const list = visible(set, filter, deferredSearch, sort);
  const label = achievementSourceLabels[set.source];
  const active = set.achievements.filter((a) => !a.removed);
  const missing = active.filter((a) => !a.unlockedAt).map((a) => a.id);

  return (
    <section className="space-y-3" aria-label={`Conquistas: ${label}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 display-sm">
            <Badge variant="outline">{label}</Badge>
            <span className="min-w-0">{set.title ?? "Lista da Steam"}</span>
          </h3>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {set.platform && `${set.platform} · `}
            {set.unlocked}/{set.total}
            {set.points > 0 && ` · ${set.pointsUnlocked}/${set.points} pts`}
          </p>
        </div>
        <div className="flex flex-wrap justify-end">
          <BulkButton
            title={missing.length > 0 ? "Marcar todas" : "Desmarcar todas"}
            question={
              missing.length > 0
                ? `Marcar as ${missing.length} conquistas que faltam como desbloqueadas?`
                : `Desmarcar as ${active.length} conquistas desta lista?`
            }
            onConfirm={() =>
              onChange(
                missing.length > 0
                  ? { ids: missing, unlocked: true }
                  : { ids: active.map((a) => a.id), unlocked: false },
              )
            }
          />
          <UnlinkButton gameId={gameId} set={set} />
        </div>
      </div>

      <Card className="gap-0 py-2">
        {list.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Nenhuma conquista aqui.</p>
        ) : (
          <ol className="divide-y-2 divide-border">
            {list.slice(0, shown).map((a) => (
              <AchievementRow key={a.id} achievement={a} onChange={onChange} />
            ))}
          </ol>
        )}
        {list.length > shown && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 self-center"
            onClick={() => setShown((n) => n + PAGE_SIZE)}
          >
            Mostrar mais ({list.length - shown})
          </Button>
        )}
      </Card>
    </section>
  );
}

const rarityFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function formatRarity(rarity: number): string {
  if (rarity > 0 && rarity < 0.1) return "<0,1% dos jogadores";
  return `${rarityFormat.format(rarity)}% dos jogadores`;
}

const unlockedDay = (iso: string) => formatDate(zonedParts(new Date(iso), DEFAULT_TIME_ZONE).date);

function AchievementRow({
  achievement: a,
  onChange,
}: {
  achievement: AchievementItem;
  onChange: (change: AchievementChange) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const unlocked = a.unlockedAt !== null;
  const secret = a.hidden && !unlocked && !revealed;
  const icon = unlocked ? a.iconUrl : (a.iconLockedUrl ?? a.iconUrl);
  const meta = [
    a.rarity !== null && formatRarity(a.rarity),
    a.points !== null && `${a.points} pts`,
    a.unlockedAt &&
      `desbloqueada em ${unlockedDay(a.unlockedAt)}${a.origin === "sync" ? " (sincronizada)" : ""}`,
    a.removed && "removida da fonte",
  ].filter(Boolean);

  return (
    <li className="flex items-center gap-3 py-2">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={unlocked}
          onChange={(e) => onChange({ ids: [a.id], unlocked: e.target.checked })}
          aria-label={secret ? "Conquista secreta" : a.title}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={cn(
            "m-0.5 grid size-6 shrink-0 place-items-center pixel-frame-thin peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-focus-visible:outline-solid [&_svg]:size-3",
            unlocked
              ? "bg-status-finished text-status-finished-foreground [--px-frame-color:var(--status-finished)]"
              : "bg-background",
          )}
        >
          {unlocked && <CheckIcon />}
        </span>
        {icon ? (
          <img
            src={icon}
            alt=""
            width={48}
            height={48}
            loading="lazy"
            referrerPolicy="no-referrer"
            className={cn(
              "size-12 shrink-0 pixel-frame-thin",
              !unlocked && !a.iconLockedUrl && "opacity-60 grayscale",
              secret && "blur-sm",
            )}
          />
        ) : (
          <span className="grid size-12 shrink-0 place-items-center bg-muted text-muted-foreground pixel-frame-thin">
            <TrophyIcon />
          </span>
        )}
        <span className={cn("min-w-0 flex-1", a.removed && "opacity-60")}>
          <span className={cn("block font-medium", secret && "blur-sm select-none")}>
            {a.title}
          </span>
          {(a.description || a.hidden) && (
            <span
              className={cn("block text-sm text-muted-foreground", secret && "blur-sm select-none")}
            >
              {a.description ?? "Conquista secreta: a fonte não mostra a descrição."}
            </span>
          )}
          {meta.length > 0 && (
            <span className="block text-xs text-muted-foreground tabular-nums">
              {meta.join(" · ")}
            </span>
          )}
        </span>
      </label>
      {secret && (
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setRevealed(true)}>
          Mostrar spoiler
        </Button>
      )}
    </li>
  );
}

function BulkButton({
  title,
  question,
  onConfirm,
}: {
  title: string;
  question: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <CheckIcon /> {title}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}?</AlertDialogTitle>
          <AlertDialogDescription>{question}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{title}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function UnlinkButton({ gameId, set }: { gameId: number; set: AchievementSetItem }) {
  const unlink = useUnlinkAchievementSet(gameId);
  const label = achievementSourceLabels[set.source];
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9" aria-label={`Desligar ${label}`}>
          <TrashIcon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desligar a lista da {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            Ela some deste jogo. Os desbloqueios ficam guardados e voltam se você ligar de novo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => unlink.mutate(set.id)}>Desligar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Escolher a lista

interface SetPickerProps {
  item: LibraryItem;
  sources: Record<AchievementSource, boolean>;
  onLinked?: () => void;
}

/** Sugestões (Steam pelo IGDB, RA pelo nome), busca no RA e "colar id ou URL". */
function SetPicker({ item, sources, onLinked }: SetPickerProps) {
  const [query, setQuery] = useState<{ q?: string; consoleId?: number }>({});
  const candidates = useQuery(achievementCandidatesQuery(item.gameId, query));
  const link = useLinkAchievementSet(item.gameId);
  const linkWith = (source: AchievementSource, id: string) =>
    link.mutate({ source, id }, { onSuccess: () => onLinked?.() });

  const result = candidates.data;
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="display-xs text-muted-foreground">Sugestões</h3>
        {candidates.isPending ? (
          <Skeleton className="h-14 w-full" />
        ) : candidates.isError ? (
          <p className="text-sm text-destructive">{candidates.error.message}</p>
        ) : result && result.candidates.length > 0 ? (
          <ul className="divide-y-2 divide-border">
            {result.candidates.map((c) => (
              <CandidateRow
                key={`${c.source}:${c.externalId}`}
                candidate={c}
                pending={link.isPending}
                onLink={() => linkWith(c.source, c.externalId)}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhuma lista encontrada
            {sources.retroachievements && result?.consoles.length === 0
              ? " (a plataforma do jogo não tem console no RetroAchievements: escolha um abaixo)"
              : ""}
            .
          </p>
        )}
        {result?.errors.map((e) => (
          <p key={e.source} className="text-sm text-destructive">
            {achievementSourceLabels[e.source]}: {e.message}
          </p>
        ))}
      </div>

      {sources.retroachievements && (
        <RaSearch
          defaultName={item.name}
          defaultConsoleId={result?.consoles[0]?.id}
          onSearch={setQuery}
        />
      )}
      <PasteId sources={sources} pending={link.isPending} onLink={linkWith} />
    </div>
  );
}

function CandidateRow({
  candidate: c,
  pending,
  onLink,
}: {
  candidate: AchievementSetCandidate;
  pending: boolean;
  onLink: () => void;
}) {
  const details = [
    c.platform,
    c.achievementsCount !== null && `${c.achievementsCount} conquistas`,
    c.points && `${c.points} pts`,
  ].filter(Boolean);
  return (
    <li className="flex items-center gap-3 py-2">
      {c.iconUrl ? (
        <img
          src={c.iconUrl}
          alt=""
          width={40}
          height={40}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-10 shrink-0 pixel-frame-thin"
        />
      ) : (
        <span className="grid size-10 shrink-0 place-items-center bg-muted pixel-frame-thin">
          <TrophyIcon />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{achievementSourceLabels[c.source]}</Badge>
          {c.subset && <Badge variant="secondary">Extra</Badge>}
          <span className="min-w-0">{c.title ?? "Sem nome"}</span>
        </p>
        <p className="text-xs text-muted-foreground">{details.join(" · ")}</p>
      </div>
      <Button size="sm" variant="outline" disabled={pending || c.linked} onClick={onLink}>
        {c.linked ? "Ligada" : "Ligar"}
      </Button>
    </li>
  );
}

function RaSearch({
  defaultName,
  defaultConsoleId,
  onSearch,
}: {
  defaultName: string;
  defaultConsoleId: number | undefined;
  onSearch: (query: { q?: string; consoleId?: number }) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [consoleId, setConsoleId] = useState<string>("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = name.trim();
    onSearch({
      ...(q.length >= 2 && q !== defaultName && { q }),
      ...(consoleId && { consoleId: Number(consoleId) }),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <h3 className="display-xs text-muted-foreground">Buscar no RetroAchievements</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-44 space-y-2">
          <Label htmlFor="ra-name">Nome</Label>
          <Input id="ra-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ra-console">Console</Label>
          <NativeSelect
            id="ra-console"
            value={consoleId || String(defaultConsoleId ?? "")}
            onChange={(e) => setConsoleId(e.target.value)}
            className="w-auto"
          >
            {defaultConsoleId === undefined && <option value="">Escolha…</option>}
            {RA_CONSOLES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline" className="mb-1">
          <SearchIcon /> Buscar
        </Button>
      </div>
    </form>
  );
}

function PasteId({
  sources,
  pending,
  onLink,
}: {
  sources: Record<AchievementSource, boolean>;
  pending: boolean;
  onLink: (source: AchievementSource, id: string) => void;
}) {
  const enabled = achievementSources.filter((s) => sources[s]);
  const [source, setSource] = useState<AchievementSource>(enabled[0] ?? "steam");
  const [id, setId] = useState("");
  if (enabled.length === 0) return null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (id.trim()) onLink(source, id.trim());
      }}
      className="space-y-2"
    >
      <h3 className="display-xs text-muted-foreground">Colar o id ou a URL</h3>
      <div className="flex flex-wrap items-end gap-2">
        {enabled.length > 1 && (
          <NativeSelect
            aria-label="Fonte"
            value={source}
            onChange={(e) => setSource(e.target.value as AchievementSource)}
            className="mb-0 w-auto"
          >
            {enabled.map((s) => (
              <option key={s} value={s}>
                {achievementSourceLabels[s]}
              </option>
            ))}
          </NativeSelect>
        )}
        <Input
          aria-label="Id ou URL do jogo na fonte"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder={
            source === "steam"
              ? "store.steampowered.com/app/504230"
              : "retroachievements.org/game/1446"
          }
          className="min-w-0 flex-1 basis-56"
        />
        <Button type="submit" variant="outline" disabled={pending || !id.trim()}>
          Ligar
        </Button>
      </div>
    </form>
  );
}

/** Crédito das fontes (exigência dos termos) e aviso de que não há afiliação. */
function Credits({ sets }: { sets: AchievementSetItem[] }) {
  return (
    <p className="text-xs text-muted-foreground">
      {sets.map((set) => (
        <span key={set.id} className="mr-3 inline-block">
          <ExternalLink href={set.url} className="underline underline-offset-2">
            Conquistas: {achievementSourceLabels[set.source]}
          </ExternalLink>
        </span>
      ))}
      Nomes, descrições, ícones e raridade vêm da Steam e do RetroAchievements. O Zerômetro não é
      afiliado à Valve nem ao RetroAchievements.
    </p>
  );
}

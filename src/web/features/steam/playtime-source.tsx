import { useQuery } from "@tanstack/react-query";
import type { PlaytimeSource } from "@shared/domain";
import type { LibraryItem } from "@shared/library";
import { DownloadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { formatMinutes } from "@/lib/format";
import { steamProfileQuery, useSyncSteamGame, useUpdateLibraryEntry } from "@/lib/queries";
import { cn } from "@/lib/utils";

const labels: Record<PlaytimeSource, string> = { sessions: "Sessões", steam: "Steam" };

/** "19/11" no fuso do aparelho. */
const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

/**
 * De onde vem o tempo jogado do jogo: as sessões daqui (com o tempo antes do Zerômetro) ou o
 * total da Steam. Só aparece com a Steam conectada (ou se o jogo já tem tempo de lá). Jogo que
 * não está na Steam (pelo IGDB): sem a opção "Steam" e com o botão de sincronizar desligado.
 */
export function PlaytimeSourceControl({ item }: { item: LibraryItem }) {
  const { data } = useQuery(steamProfileQuery());
  const sync = useSyncSteamGame(item.gameId);
  const update = useUpdateLibraryEntry(item.gameId);
  if (!data?.enabled || (!data.profile && !item.steamPlaytime)) return null;

  const busy = sync.isPending || update.isPending;
  const steam = item.steamPlaytime;
  // null (ainda não conferido no IGDB) conta como talvez: a sincronização confere.
  const notOnSteam = item.onSteam === false;
  const sources: PlaytimeSource[] =
    notOnSteam && item.playtimeSource !== "steam" ? ["sessions"] : ["sessions", "steam"];

  async function choose(source: PlaytimeSource) {
    if (source === item.playtimeSource) return;
    if (source === "steam" && !steam) {
      // Ainda sem tempo da Steam: sincroniza antes (e desiste se o jogo não está na conta).
      try {
        const { sync: result } = await sync.mutateAsync();
        if (!result.owned) return;
      } catch {
        return; // o erro já virou toast
      }
    }
    update.mutate({ playtimeSource: source });
  }

  return (
    <div className="space-y-2 border-t-2 border-border pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="display-xs text-muted-foreground">Tempo jogado vem de</span>
        <fieldset className="inline-flex bg-background pixel-frame-thin" disabled={busy}>
          <legend className="sr-only">Tempo jogado vem de</legend>
          {sources.map((source) => (
            <button
              key={source}
              type="button"
              aria-pressed={item.playtimeSource === source}
              onClick={() => void choose(source)}
              className={cn(
                "h-8 cursor-pointer px-3 display-xs disabled:cursor-wait",
                item.playtimeSource === source
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {labels[source]}
            </button>
          ))}
        </fieldset>
        {data.profile && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => sync.mutate()}
            disabled={busy || notOnSteam}
            title={notOnSteam ? "Esse jogo não está na Steam" : undefined}
          >
            <DownloadIcon /> {sync.isPending ? "Sincronizando…" : "Sincronizar com a Steam"}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{explain(item)}</p>
    </div>
  );
}

function explain(item: LibraryItem): string {
  const steam = item.steamPlaytime;
  if (item.playtimeSource === "steam" && steam) {
    return (
      `Pelo total da Steam (sincronizado em ${shortDay(steam.syncedAt)}). ` +
      `As sessões daqui (${formatMinutes(item.sessionMinutes)}) continuam contando na ofensiva e nas estatísticas.`
    );
  }
  const manual =
    item.priorMinutes > 0
      ? "Pelas sessões daqui, somadas ao tempo de antes do Zerômetro."
      : "Pelas sessões registradas aqui.";
  if (!steam) {
    return item.onSteam === false
      ? `${manual} Esse jogo não está na Steam (pelo IGDB).`
      : `${manual} Sincronize para ver o tempo na Steam.`;
  }
  return `${manual} Na Steam: ${formatMinutes(steam.minutes)} (sincronizado em ${shortDay(steam.syncedAt)}).`;
}

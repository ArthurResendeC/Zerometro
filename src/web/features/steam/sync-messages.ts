import type {
  SteamAutoSync,
  SteamGameSync,
  SteamImportResult,
  SteamLibrarySync,
} from "@shared/steam";
import { formatMinutes } from "@/lib/format";

// Textos do resultado de uma sincronização com a Steam (toast).

const unlocksText = (n: number) =>
  n === 0 ? "nenhuma conquista nova" : n === 1 ? "1 conquista nova" : `${n} conquistas novas`;

/** O jogado na Steam desde a última sincronização que virou sessão (entra na ofensiva). */
const sessionText = (minutes: number) =>
  minutes > 0 && `+${formatMinutes(minutes)} em sessões da Steam`;

export function gameSyncMessage(sync: SteamGameSync): { title: string; description?: string } {
  if (sync.appId === null) return { title: "Esse jogo não está na Steam" };
  if (!sync.owned && sync.newUnlocks === 0) {
    return {
      title: "Esse jogo não está na sua conta Steam",
      description: "Jogos emprestados (Compartilhamento Familiar) não aparecem na conta.",
    };
  }
  const parts: (string | false)[] = [unlocksText(sync.newUnlocks)];
  if (sync.steamMinutes !== null) parts.push(`${formatMinutes(sync.steamMinutes)} na Steam`);
  if (sync.sessionMinutes > 0) parts.push(sessionText(sync.sessionMinutes));
  return {
    title: "Sincronizado com a Steam",
    description: [
      parts.filter(Boolean).join(" · "),
      sync.linkedSet && "A lista de conquistas da Steam foi ligada ao jogo.",
      // A Steam devolve 0 para tudo quando o perfil esconde o tempo de jogo.
      sync.steamMinutes === 0 &&
        'Se você já jogou, o perfil pode estar escondendo o tempo: em Privacidade, desmarque "Sempre manter meu tempo total de jogo privado".',
    ]
      .filter(Boolean)
      .join(". "),
  };
}

export function librarySyncMessage(sync: SteamLibrarySync): {
  title: string;
  description?: string;
} {
  const owned = sync.games.filter((g) => g.owned);
  const failed = sync.games.filter((g) => g.error);
  const title =
    owned.length === 0
      ? "Nenhum jogo da biblioteca está na sua conta Steam"
      : `${owned.length} ${owned.length === 1 ? "jogo sincronizado" : "jogos sincronizados"}`;
  const description = [
    owned.length > 0 && unlocksText(sync.newUnlocks),
    sessionText(sync.games.reduce((sum, g) => sum + g.sessionMinutes, 0)),
    failed.length > 0 && `${failed.length} com erro (${failed.map((g) => g.name).join(", ")})`,
  ]
    .filter(Boolean)
    .join(" · ");
  return description ? { title, description } : { title };
}

const MAX_GAMES_IN_TOAST = 3;

/** Automática: só vale avisar quando chegou conquista nova (horas mudam em silêncio). */
export function autoSyncMessage(
  sync: SteamAutoSync,
): { title: string; description: string } | null {
  const games = sync.games
    .filter((g) => g.newUnlocks > 0)
    .toSorted((a, b) => b.newUnlocks - a.newUnlocks);
  if (games.length === 0) return null;
  const shown = games.slice(0, MAX_GAMES_IN_TOAST).map((g) => `${g.name} (+${g.newUnlocks})`);
  const rest = games.length - shown.length;
  return {
    title: `Steam: ${unlocksText(sync.newUnlocks)}`,
    description:
      shown.join(", ") + (rest > 0 ? ` e mais ${rest} ${rest === 1 ? "jogo" : "jogos"}` : ""),
  };
}

export function importMessage(
  result: SteamImportResult & { newUnlocks: number; interrupted: boolean },
): { title: string; description?: string } {
  const n = result.added.length;
  const title =
    n === 0
      ? "Nenhum jogo importado"
      : `${n} ${n === 1 ? "jogo importado" : "jogos importados"} da Steam`;
  const description = [
    n > 0 && !result.interrupted && unlocksText(result.newUnlocks),
    result.interrupted &&
      "As conquistas de alguns jogos ficaram para a próxima sincronização automática",
    result.skipped.length > 0 &&
      `${result.skipped.length} ${result.skipped.length === 1 ? "ficou" : "ficaram"} de fora (${[
        ...new Set(result.skipped.map((s) => s.reason.toLowerCase())),
      ].join("; ")})`,
  ]
    .filter(Boolean)
    .join(" · ");
  return description ? { title, description } : { title };
}

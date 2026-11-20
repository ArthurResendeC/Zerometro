import type { SteamGameSync, SteamLibrarySync } from "@shared/steam";
import { formatMinutes } from "@/lib/format";

// Textos do resultado de uma sincronização com a Steam (toast).

const unlocksText = (n: number) =>
  n === 0 ? "nenhuma conquista nova" : n === 1 ? "1 conquista nova" : `${n} conquistas novas`;

export function gameSyncMessage(sync: SteamGameSync): { title: string; description?: string } {
  if (sync.appId === null) return { title: "Esse jogo não está na Steam" };
  if (!sync.owned && sync.newUnlocks === 0) {
    return {
      title: "Esse jogo não está na sua conta Steam",
      description: "Jogos emprestados (Compartilhamento Familiar) não aparecem na conta.",
    };
  }
  const parts = [unlocksText(sync.newUnlocks)];
  if (sync.steamMinutes !== null) parts.push(`${formatMinutes(sync.steamMinutes)} na Steam`);
  return {
    title: "Sincronizado com a Steam",
    description: [
      parts.join(" · "),
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
    failed.length > 0 && `${failed.length} com erro (${failed.map((g) => g.name).join(", ")})`,
  ]
    .filter(Boolean)
    .join(" · ");
  return description ? { title, description } : { title };
}

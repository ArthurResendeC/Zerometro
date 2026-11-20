import { useQuery } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";
import { STEAM_AUTO_SYNC_INTERVAL_MS } from "@shared/steam";
import { useOnline } from "@/features/offline/use-online";
import { steamProfileQuery, useAutoSyncSteam } from "@/lib/queries";

/** Um pedido por vez neste aparelho (o StrictMode do dev roda o efeito duas vezes). */
let inFlight = false;

/**
 * Sincroniza com a Steam ao abrir o app e ao voltar para ele (aba ou PWA em primeiro plano).
 * Quem decide se roda é o servidor (no máximo a cada 30 min, para todos os aparelhos); aqui só
 * evita perguntar enquanto o último resultado conhecido ainda está dentro do intervalo.
 */
export function useSteamAutoSync() {
  const { data } = useQuery(steamProfileQuery());
  const online = useOnline();
  const { mutateAsync } = useAutoSyncSteam();
  const steamId = data?.enabled ? data.profile?.steamId : undefined;
  const lastRunAt = data?.auto?.lastRunAt;

  // Lê o estado atual sem recriar o listener de visibilidade a cada mudança.
  const maybeSync = useEffectEvent(() => {
    if (inFlight || document.visibilityState !== "visible") return;
    if (lastRunAt && Date.now() - Date.parse(lastRunAt) < STEAM_AUTO_SYNC_INTERVAL_MS) return;
    inFlight = true;
    // Falha de rede: fica para a próxima vez que o app abrir (o resultado vai para o cache no
    // onSuccess do useAutoSyncSteam, mesmo se este componente sair da tela).
    mutateAsync()
      .catch(() => {})
      .finally(() => {
        inFlight = false;
      });
  });

  useEffect(() => {
    if (!steamId || !online) return;
    maybeSync();
    document.addEventListener("visibilitychange", maybeSync);
    return () => document.removeEventListener("visibilitychange", maybeSync);
  }, [steamId, online]);
}

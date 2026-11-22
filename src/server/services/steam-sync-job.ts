import type { Db } from "../db/client";
import { type Clock, createContext } from "./context";
import { steamLinkedUserIds } from "./steam-account";
import { autoSyncSteam, type SteamSyncDeps } from "./steam-sync";

// Sincronização automática de meia em meia hora, no servidor, para todo mundo com perfil da Steam.
// Sem ela, as horas da Steam só viram sessão quando o app é aberto, e dias jogados sem abrir o
// Zerômetro cairiam todos num dia só (a ofensiva perderia dias). Usa a mesma rodada do "abrir o
// app" (`autoSyncSteam`): se alguém abriu há pouco, pula. De meia em meia hora para as sessões da
// Steam terem início e fim mais perto do real e as pausas aparecerem (ver steam-session-chunks).

export const STEAM_SYNC_JOB_INTERVAL_MS = 30 * 60_000;
/** O job pula quem sincronizou há menos disto (folga para o timer atrasar ou adiantar). */
const JOB_MIN_INTERVAL_MS = STEAM_SYNC_JOB_INTERVAL_MS - 5 * 60_000;

/** Uma rodada: um usuário de cada vez (a Steam e o IGDB têm limite de requisições). */
export async function runSteamSyncJob(db: Db, clock: Clock, deps: SteamSyncDeps): Promise<void> {
  if (!deps.steamUser.enabled) return;
  for (const userId of steamLinkedUserIds(db)) {
    try {
      // oxlint-disable-next-line no-await-in-loop
      await autoSyncSteam(createContext(db, clock, "job", userId), deps, {
        minIntervalMs: JOB_MIN_INTERVAL_MS,
      });
    } catch (error) {
      // A rodada guarda os erros esperados no estado; isto é o inesperado (ex.: banco).
      console.error(`Sincronização da Steam de meia em meia hora (${userId}):`, error);
    }
  }
}

/** Liga o job (a primeira rodada logo depois do boot). Devolve a função que desliga. */
export function startSteamSyncJob(db: Db, clock: Clock, deps: SteamSyncDeps): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runSteamSyncJob(db, clock, deps);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, 60_000);
  const interval = setInterval(tick, STEAM_SYNC_JOB_INTERVAL_MS);
  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}

import {
  parseSteamProfile,
  type LinkSteamProfileInput,
  type SteamAutoSyncState,
  type SteamProfile,
} from "../../shared/steam";
import { ValidationError } from "../errors";
import { logActivity } from "./activity";
import type { ServiceContext, UserScope } from "./context";
import { deleteKv, getKv, setKv } from "./kv";
import type { SteamUserApi } from "./steam/user";

// O perfil da Steam de cada usuário (no `kv`): de onde vêm as conquistas desbloqueadas e as
// horas na sincronização. É público (SteamID e nome), sem token nem senha.

const profileKey = (userId: string) => `steam:profile:${userId}`;
const autoSyncKey = (userId: string) => `steam:auto:${userId}`;
const ignoredKey = (userId: string) => `steam:import-ignored:${userId}`;

export function getSteamProfile({ db, userId }: UserScope): SteamProfile | null {
  const raw = getKv(db, profileKey(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SteamProfile;
  } catch {
    return null;
  }
}

/** Confere o perfil na Steam (existe? qual o SteamID?) e guarda. */
export async function linkSteamProfile(
  ctx: ServiceContext,
  steamUser: SteamUserApi,
  input: LinkSteamProfileInput,
): Promise<SteamProfile> {
  const ref = parseSteamProfile(input.profile);
  if (!ref) throw new ValidationError("Isso não parece um perfil da Steam");
  const player = await steamUser.resolveProfile(ref);
  const profile: SteamProfile = { ...player, linkedAt: ctx.now.toISOString() };
  ctx.db.transaction((tx) => {
    setKv(tx, profileKey(ctx.userId), JSON.stringify(profile));
    // Perfil novo: a próxima abertura do app já sincroniza, e nada da outra conta fica ignorado.
    deleteKv(tx, autoSyncKey(ctx.userId));
    deleteKv(tx, ignoredKey(ctx.userId));
    logActivity(tx, ctx, "steam.link", { steamId: profile.steamId, name: profile.name });
  });
  return profile;
}

/** Esquece o perfil. O que já foi sincronizado (desbloqueios, horas) continua. */
export function unlinkSteamProfile(ctx: ServiceContext): void {
  const profile = getSteamProfile(ctx);
  if (!profile) return;
  deleteKv(ctx.db, profileKey(ctx.userId));
  deleteKv(ctx.db, autoSyncKey(ctx.userId));
  deleteKv(ctx.db, ignoredKey(ctx.userId));
  logActivity(ctx.db, ctx, "steam.unlink", { steamId: profile.steamId });
}

/** Quando foi a última sincronização automática (ou "Sincronizar tudo") e se deu erro. */
export function getAutoSyncState({ db, userId }: UserScope): SteamAutoSyncState | null {
  const raw = getKv(db, autoSyncKey(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SteamAutoSyncState;
  } catch {
    return null;
  }
}

export function setAutoSyncState({ db, userId }: UserScope, state: SteamAutoSyncState): void {
  setKv(db, autoSyncKey(userId), JSON.stringify(state));
}

/** Apps da Steam que a pessoa deixou de fora ao importar (não vêm marcados de novo). */
export function getIgnoredSteamApps({ db, userId }: UserScope): Set<number> {
  const raw = getKv(db, ignoredKey(userId));
  if (!raw) return new Set();
  try {
    const ids: unknown = JSON.parse(raw);
    return new Set(Array.isArray(ids) ? ids.filter((id) => Number.isSafeInteger(id)) : []);
  } catch {
    return new Set();
  }
}

export function setIgnoredSteamApps({ db, userId }: UserScope, appIds: Set<number>): void {
  if (appIds.size === 0) deleteKv(db, ignoredKey(userId));
  else setKv(db, ignoredKey(userId), JSON.stringify([...appIds].toSorted((a, b) => a - b)));
}

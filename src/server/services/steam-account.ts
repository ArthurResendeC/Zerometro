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
    // Perfil novo: a próxima abertura do app já sincroniza.
    deleteKv(tx, autoSyncKey(ctx.userId));
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

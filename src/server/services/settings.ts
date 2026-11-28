import {
  DEFAULT_SETTINGS,
  type Settings,
  settingsSchema,
  type UpdateSettingsInput,
} from "../../shared/settings";
import { itemName } from "../../shared/items";
import { ItemNotOwnedError } from "../errors";
import { logActivity } from "./activity";
import type { ServiceContext, UserScope } from "./context";
import { ownsItem } from "./items";
import { getKv, setKv } from "./kv";

const settingsKey = (userId: string) => `settings:${userId}`;

/**
 * Ajustes do usuário por cima dos padrões; campos inválidos ou ausentes caem no padrão, e um tema
 * ou pacote de som que o usuário não tem mais volta ao padrão.
 */
export function getSettings(scope: UserScope): Settings {
  const settings = readStored(scope);
  if (!ownsItem(scope, "theme", settings.themeId)) settings.themeId = DEFAULT_SETTINGS.themeId;
  if (settings.soundPackId && !ownsItem(scope, "sound_pack", settings.soundPackId)) {
    settings.soundPackId = null;
  }
  return settings;
}

function readStored({ db, userId }: UserScope): Settings {
  const raw = getKv(db, settingsKey(userId));
  if (!raw) return { ...DEFAULT_SETTINGS };
  const settings = { ...DEFAULT_SETTINGS };
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return settings;
  }
  for (const [key, schema] of Object.entries(settingsSchema.shape)) {
    const parsed = schema.safeParse(stored[key]);
    if (parsed.success) Object.assign(settings, { [key]: parsed.data });
  }
  return settings;
}

export function updateSettings(ctx: ServiceContext, patch: UpdateSettingsInput): Settings {
  if (patch.themeId && !ownsItem(ctx, "theme", patch.themeId)) {
    throw new ItemNotOwnedError(`Você ainda não tem o tema ${itemName("theme", patch.themeId)}`);
  }
  if (patch.soundPackId && !ownsItem(ctx, "sound_pack", patch.soundPackId)) {
    throw new ItemNotOwnedError(
      `Você ainda não tem o pacote de sons ${itemName("sound_pack", patch.soundPackId)}`,
    );
  }
  const settings = { ...getSettings(ctx), ...patch };
  ctx.db.transaction((tx) => {
    setKv(tx, settingsKey(ctx.userId), JSON.stringify(settings));
    logActivity(tx, ctx, "settings.update", patch);
  });
  return settings;
}

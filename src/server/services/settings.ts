import {
  DEFAULT_SETTINGS,
  type Settings,
  settingsSchema,
  type UpdateSettingsInput,
} from "../../shared/settings";
import { logActivity } from "./activity";
import type { ServiceContext, UserScope } from "./context";
import { getKv, setKv } from "./kv";

const settingsKey = (userId: string) => `settings:${userId}`;

/** Ajustes do usuário por cima dos padrões; campos inválidos ou ausentes caem no padrão. */
export function getSettings({ db, userId }: UserScope): Settings {
  const raw = getKv(db, settingsKey(userId));
  if (!raw) return DEFAULT_SETTINGS;
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
  const settings = { ...getSettings(ctx), ...patch };
  ctx.db.transaction((tx) => {
    setKv(tx, settingsKey(ctx.userId), JSON.stringify(settings));
    logActivity(tx, ctx, "settings.update", patch);
  });
  return settings;
}

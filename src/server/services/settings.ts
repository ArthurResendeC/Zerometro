import {
  DEFAULT_SETTINGS,
  type Settings,
  settingsSchema,
  type UpdateSettingsInput,
} from "../../shared/settings";
import type { Db } from "../db/client";
import { logActivity } from "./activity";
import type { ServiceContext } from "./context";
import { getKv, setKv } from "./kv";

const SETTINGS_KEY = "settings";

/** Ajustes salvos por cima dos padrões; campos inválidos ou ausentes caem no padrão. */
export function getSettings(db: Db): Settings {
  const raw = getKv(db, SETTINGS_KEY);
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
  const settings = { ...getSettings(ctx.db), ...patch };
  ctx.db.transaction((tx) => {
    setKv(tx, SETTINGS_KEY, JSON.stringify(settings));
    logActivity(tx, ctx.actor, "settings.update", patch);
  });
  return settings;
}

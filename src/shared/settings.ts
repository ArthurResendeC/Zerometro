import { z } from "zod";

// Preferências do usuário (guardadas no `kv`), compartilhadas por API, frontend e MCP.

/** Mínimo jogado no dia para contar na ofensiva: de 10min a 12h. */
export const STREAK_MIN_MINUTES = { min: 10, max: 12 * 60, default: 30 } as const;

export const settingsSchema = z.object({
  streakMinMinutes: z
    .number()
    .int()
    .min(STREAK_MIN_MINUTES.min, "O mínimo da ofensiva é de pelo menos 10min")
    .max(STREAK_MIN_MINUTES.max, "O mínimo da ofensiva vai até 12h"),
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = { streakMinMinutes: STREAK_MIN_MINUTES.default };

export const updateSettingsSchema = settingsSchema
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "Nada para atualizar");
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

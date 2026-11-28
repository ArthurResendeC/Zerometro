import { z } from "zod";
import { groupSectionsSchema } from "./group-sections";
import { BLEND_WEIGHT, ratingModeSchema, ratingWeightsSchema } from "./ratings";

// Preferências do usuário (guardadas no `kv`), compartilhadas por API, frontend e MCP.

/** Mínimo jogado no dia para contar na ofensiva: de 10min a 12h. */
export const STREAK_MIN_MINUTES = { min: 10, max: 12 * 60, default: 30 } as const;

/** A partir de quanto tempo o timer pergunta "jogou tudo isso mesmo?": de 1h a 24h. */
export const LONG_SESSION_MINUTES = { min: 60, max: 24 * 60, default: 6 * 60 } as const;

export const settingsSchema = z.object({
  streakMinMinutes: z
    .number()
    .int()
    .min(STREAK_MIN_MINUTES.min, "O mínimo da ofensiva é de pelo menos 10min")
    .max(STREAK_MIN_MINUTES.max, "O mínimo da ofensiva vai até 12h"),
  longSessionMinutes: z
    .number()
    .int()
    .min(LONG_SESSION_MINUTES.min, "O aviso de sessão longa começa em pelo menos 1h")
    .max(LONG_SESSION_MINUTES.max, "O aviso de sessão longa vai até 24h"),
  /** Como sai a nota final das avaliações. */
  ratingMode: ratingModeSchema,
  /** Peso da nota calculada na mistura com a de coração. */
  ratingBlendWeight: z
    .number()
    .min(BLEND_WEIGHT.min, "A calculada pesa pelo menos 10% na mistura")
    .max(BLEND_WEIGHT.max, "A calculada pesa no máximo 90% na mistura"),
  /** Pesos padrão personalizados (null = os do método). */
  ratingCustomWeights: ratingWeightsSchema.nullable(),
  /** Aparecer no ranking do grupo e deixar os amigos verem o perfil (padrão: sim). */
  shareWithGroup: z.boolean(),
  /** O que os amigos veem no /amigo (só as seções fora do padrão; veja `isSectionShared`). */
  groupSections: groupSectionsSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  streakMinMinutes: STREAK_MIN_MINUTES.default,
  longSessionMinutes: LONG_SESSION_MINUTES.default,
  ratingMode: "blend",
  ratingBlendWeight: BLEND_WEIGHT.default,
  ratingCustomWeights: null,
  shareWithGroup: true,
  groupSections: {},
};

export const updateSettingsSchema = settingsSchema
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "Nada para atualizar");
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

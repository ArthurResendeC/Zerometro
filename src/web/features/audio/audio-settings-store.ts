import { z } from "zod";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// Preferências de áudio deste aparelho (estado de UI, não vai para o servidor), salvas no localStorage.

export const DEFAULT_AUDIO_SETTINGS = { enabled: false, volume: 0.5 } as const;

/** Cada campo inválido (ou ausente) cai no padrão; o resto do que estava salvo é mantido. */
export const audioSettingsSchema = z
  .object({
    enabled: z.boolean().catch(DEFAULT_AUDIO_SETTINGS.enabled),
    volume: z.number().min(0).max(1).catch(DEFAULT_AUDIO_SETTINGS.volume),
  })
  .catch({ ...DEFAULT_AUDIO_SETTINGS });
export type AudioSettings = z.infer<typeof audioSettingsSchema>;

export function parseAudioSettings(raw: unknown): AudioSettings {
  return audioSettingsSchema.parse(raw ?? {});
}

interface AudioSettingsState extends AudioSettings {
  setEnabled: (enabled: boolean) => void;
  setVolume: (volume: number) => void;
}

const clampVolume = (volume: number) =>
  Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_AUDIO_SETTINGS.volume;

export const AUDIO_SETTINGS_STORAGE_KEY = "zerometro:audio";

export const useAudioSettings = create<AudioSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_AUDIO_SETTINGS,
      setEnabled: (enabled) => set({ enabled }),
      setVolume: (volume) => set({ volume: clampVolume(volume) }),
    }),
    {
      name: AUDIO_SETTINGS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ enabled, volume }) => ({ enabled, volume }),
      // O localStorage pode ter sido editado à mão ou vir de uma versão antiga: valida antes de usar.
      merge: (persisted, current) => ({ ...current, ...parseAudioSettings(persisted) }),
    },
  ),
);

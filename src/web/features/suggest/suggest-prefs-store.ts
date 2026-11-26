import { z } from "zod";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { type AvailableTime, availableTimeSchema, type Mood, moodSchema } from "@shared/suggest";

// Últimas escolhas do "Me sugere" neste aparelho (estado de UI, não vai para o servidor).

const prefsSchema = z.object({
  available: availableTimeSchema.nullable().catch(null),
  mood: moodSchema.nullable().catch(null),
  platform: z.string().nullable().catch(null),
});
type SuggestPrefs = z.infer<typeof prefsSchema>;

interface SuggestPrefsState extends SuggestPrefs {
  /** Escolher o que já está escolhido desmarca. */
  toggleAvailable: (value: AvailableTime) => void;
  toggleMood: (value: Mood) => void;
  setPlatform: (value: string | null) => void;
}

export const useSuggestPrefs = create<SuggestPrefsState>()(
  persist(
    (set) => ({
      available: null,
      mood: null,
      platform: null,
      toggleAvailable: (value) => set((s) => ({ available: s.available === value ? null : value })),
      toggleMood: (value) => set((s) => ({ mood: s.mood === value ? null : value })),
      setPlatform: (platform) => set({ platform }),
    }),
    {
      name: "zerometro:suggest",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ available, mood, platform }) => ({ available, mood, platform }),
      merge: (persisted, current) => ({
        ...current,
        ...prefsSchema
          .catch({ available: null, mood: null, platform: null })
          .parse(persisted ?? {}),
      }),
    },
  ),
);

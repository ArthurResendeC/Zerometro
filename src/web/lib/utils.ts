import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// frame-space e frame-space-drop (styles.css) são margens: um m-* depois deles os substitui, e
// eles substituem as margens de antes. Margens de um lado só (mb-1) convivem e vencem no CSS.
const twMerge = extendTailwindMerge<"frame-space">({
  extend: {
    classGroups: { "frame-space": ["frame-space", "frame-space-drop"] },
    conflictingClassGroups: {
      m: ["frame-space"],
      "frame-space": ["m", "mx", "my", "mt", "mr", "mb", "ml", "ms", "me"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Texto para comparar em buscas: sem acentos e em minúsculas ("Pokémon" acha "pokemon"). */
export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

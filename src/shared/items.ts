import { z } from "zod";
import { DEFAULT_THEME, isThemeId, type ThemeId, themes } from "./themes";

// Itens da personalização (temas e pacotes de som): o que existe, de onde vem a posse e o que é
// de graça. A posse mora na tabela `user_items`; o que é grátis não precisa de linha.

export const itemKinds = ["theme", "sound_pack"] as const;
export type ItemKind = (typeof itemKinds)[number];
export const itemKindSchema = z.enum(itemKinds);

/**
 * Como o item chegou: comprado na loja, ganho por insígnia, presente de um amigo, bônus de
 * fundador ou concedido pelo admin.
 */
export const itemSources = ["purchase", "badge", "gift", "founder", "grant"] as const;
export type ItemSource = (typeof itemSources)[number];
export const itemSourceSchema = z.enum(itemSources);

/** Pacotes de som (jsfxr): os de cada tema. O do tema base é o padrão de todo mundo. */
export const soundPackIds = ["cartucho", "minimal", "ladrao-fantasma"] as const;
export type SoundPackId = (typeof soundPackIds)[number];
export const DEFAULT_SOUND_PACK: SoundPackId = "cartucho";

export const soundPacks: Record<SoundPackId, { id: SoundPackId; name: string }> = {
  cartucho: { id: "cartucho", name: "8 bits do Cartucho" },
  minimal: { id: "minimal", name: "Toques do Minimal" },
  "ladrao-fantasma": { id: "ladrao-fantasma", name: "Golpes do Ladrão Fantasma" },
};

export function isSoundPackId(value: unknown): value is SoundPackId {
  return typeof value === "string" && (soundPackIds as readonly string[]).includes(value);
}

/** O pacote de som que acompanha cada tema (quem tem o tema leva o pacote junto). */
export const themeSoundPack: Record<ThemeId, SoundPackId> = {
  cartucho: "cartucho",
  minimal: "minimal",
  "ladrao-fantasma": "ladrao-fantasma",
};

export function isItemId(kind: ItemKind, id: unknown): boolean {
  return kind === "theme" ? isThemeId(id) : isSoundPackId(id);
}

/** De graça para todo mundo: o tema base e o pacote de som dele. */
export function isFreeItem(kind: ItemKind, id: string): boolean {
  return kind === "theme" ? id === DEFAULT_THEME : id === DEFAULT_SOUND_PACK;
}

/** Item que alguém tem (de graça ou com linha em `user_items`). */
export interface OwnedItem {
  kind: ItemKind;
  itemId: string;
  /** null = de graça. */
  source: ItemSource | null;
  acquiredAt: string | null;
}

export const grantItemSchema = z
  .object({ kind: itemKindSchema, itemId: z.string().min(1).max(64) })
  .refine(({ kind, itemId }) => isItemId(kind, itemId), {
    message: "Item desconhecido",
    path: ["itemId"],
  });
export type GrantItemInput = z.infer<typeof grantItemSchema>;

/** Nome para mostrar de um item. */
export function itemName(kind: ItemKind, id: string): string {
  if (kind === "theme" && isThemeId(id)) return themes[id].name;
  if (kind === "sound_pack" && isSoundPackId(id)) return soundPacks[id].name;
  return id;
}

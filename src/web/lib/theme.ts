// Tema ativo: atributos do <html> (data-theme, data-mode), fontes do tema e <meta theme-color>.
// O script inline do index.html aplica o tema salvo antes da primeira pintura (sem piscar o tema
// base); aqui fica o resto. Contrato: docs/gamificacao/temas-contrato.md.

import { create } from "zustand";
import { DEFAULT_THEME, isThemeId, type ThemeId, type ThemeMode, themes } from "@shared/themes";

export type { ThemeMode };

/** O que o script inline do index.html lê: já resolvido, para ele não precisar do registro. */
export const THEME_STORAGE_KEY = "zerometro:theme";
interface StoredTheme {
  id: ThemeId;
  mode: ThemeMode;
  fontsHref: string | null;
  themeColor: string | null;
}

const FONTS_LINK_ID = "theme-fonts";

function readStored(): StoredTheme | null {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredTheme>) : null;
    return parsed && isThemeId(parsed.id) ? (parsed as StoredTheme) : null;
  } catch {
    return null;
  }
}

function writeStored(value: StoredTheme | null) {
  try {
    if (value) localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Sem armazenamento (aba anônima, bloqueado): o tema vale só até recarregar.
  }
}

/** Aplica um tema no documento: atributos, fontes e cor da barra do navegador. */
function applyToDocument(theme: StoredTheme) {
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.dataset.mode = theme.mode;

  let link = document.getElementById(FONTS_LINK_ID) as HTMLLinkElement | null;
  if (theme.fontsHref) {
    if (!link) {
      link = document.createElement("link");
      link.id = FONTS_LINK_ID;
      link.rel = "stylesheet";
      document.head.append(link);
    }
    if (link.href !== theme.fontsHref) link.href = theme.fontsHref;
  } else {
    link?.remove();
  }

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta && theme.themeColor) meta.content = theme.themeColor;
}

function resolve(id: ThemeId, mode?: ThemeMode): StoredTheme {
  const def = themes[id];
  const resolvedMode = mode && def.modes.includes(mode) ? mode : def.modes[0]!;
  return {
    id,
    mode: resolvedMode,
    fontsHref: def.fontsHref,
    themeColor: def.themeColor[resolvedMode] ?? null,
  };
}

interface ThemeState {
  id: ThemeId;
  mode: ThemeMode;
  /** Troca o tema (e guarda neste aparelho). O tema base não fica salvo: é o padrão. */
  setTheme: (id: ThemeId, mode?: ThemeMode) => void;
}

export const useTheme = create<ThemeState>((set) => {
  const initial = typeof document === "undefined" ? null : readStored();
  return {
    id: initial?.id ?? DEFAULT_THEME,
    mode: initial?.mode ?? themes[DEFAULT_THEME].modes[0]!,
    setTheme: (id, mode) => {
      const theme = resolve(id, mode);
      applyToDocument(theme);
      writeStored(
        id === DEFAULT_THEME && theme.mode === themes[DEFAULT_THEME].modes[0] ? null : theme,
      );
      set({ id: theme.id, mode: theme.mode });
    },
  };
});

/** Modo (claro/escuro) do tema ativo, para o que não lê o CSS (ex.: o sonner). */
export function currentMode(): ThemeMode {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.mode === "light" ? "light" : "dark";
}

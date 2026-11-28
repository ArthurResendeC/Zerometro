// Tema ativo: atributos do <html> (data-theme, data-mode), fontes do tema e <meta theme-color>.
// O tema da conta vem dos ajustes (ThemeSync); uma prévia (a de desenvolvimento,
// e a da loja no futuro) vale por cima dele até ser encerrada. O script inline do index.html
// aplica o último tema antes da primeira pintura. Contrato: docs/gamificacao/temas-contrato.md.

import { create } from "zustand";
import { type SoundPackId, themeSoundPack } from "@shared/items";
import { DEFAULT_THEME, isThemeId, type ThemeId, type ThemeMode, themes } from "@shared/themes";

export type { ThemeMode };

/** O que o script inline do index.html lê: já resolvido, para ele não precisar do registro. */
export const THEME_STORAGE_KEY = "zerometro:theme";
interface StoredTheme {
  id: ThemeId;
  mode: ThemeMode;
  fontsHref: string | null;
  themeColor: string | null;
  /** Tema da conta guardado junto, para voltar a ele ao fim de uma prévia antes dos ajustes chegarem. */
  accountId?: ThemeId;
  /** Este tema é uma prévia (não é o da conta). */
  preview?: boolean;
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

function resolve(id: ThemeId): Omit<StoredTheme, "accountId" | "preview"> {
  const def = themes[id];
  const mode = def.modes[0]!;
  return { id, mode, fontsHref: def.fontsHref, themeColor: def.themeColor[mode] ?? null };
}

/** Aplica um tema no documento: atributos, fontes e cor da barra do navegador. */
function applyToDocument(id: ThemeId) {
  const theme = resolve(id);
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

interface ThemeState {
  /** Tema dos ajustes da conta. */
  accountId: ThemeId;
  /** Pacote de sons escolhido na conta (null = o do tema). */
  accountSoundPack: SoundPackId | null;
  /** Tema em prévia, por cima do da conta (null = sem prévia). */
  previewId: ThemeId | null;
  /** O que está na tela: a prévia, se houver, senão o da conta. */
  activeId: ThemeId;
  /** Sincroniza com os ajustes da conta (não interrompe uma prévia). */
  setAccount: (themeId: ThemeId, soundPack: SoundPackId | null) => void;
  /** Mostra um tema sem salvar na conta. */
  startPreview: (id: ThemeId) => void;
  endPreview: () => void;
}

function sync(state: Pick<ThemeState, "accountId" | "accountSoundPack" | "previewId">) {
  const activeId = state.previewId ?? state.accountId;
  if (typeof document !== "undefined") {
    applyToDocument(activeId);
    const isBase = activeId === DEFAULT_THEME && !state.previewId;
    writeStored(
      isBase
        ? null
        : { ...resolve(activeId), accountId: state.accountId, preview: Boolean(state.previewId) },
    );
  }
  return activeId;
}

/** Pacote de sons que vale agora: na prévia, o do tema em prévia; fora dela, a escolha da conta. */
export function activeSoundPack(
  state: Pick<ThemeState, "accountId" | "accountSoundPack" | "previewId">,
): SoundPackId {
  return state.previewId
    ? themeSoundPack[state.previewId]
    : (state.accountSoundPack ?? themeSoundPack[state.accountId]);
}

export const useTheme = create<ThemeState>((set, get) => {
  const stored = typeof document === "undefined" ? null : readStored();
  const accountId = stored?.preview
    ? (stored.accountId ?? DEFAULT_THEME)
    : (stored?.id ?? DEFAULT_THEME);
  const previewId = stored?.preview ? stored.id : null;
  const initial = { accountId, accountSoundPack: null, previewId };

  return {
    ...initial,
    activeId: previewId ?? accountId,
    setAccount: (themeId, soundPack) => {
      const { accountId: current, accountSoundPack, previewId: preview } = get();
      if (current === themeId && accountSoundPack === soundPack) return;
      const next = { accountId: themeId, accountSoundPack: soundPack, previewId: preview };
      set({ ...next, activeId: sync(next) });
    },
    startPreview: (id) => {
      const { accountId: account, accountSoundPack } = get();
      const next = { accountId: account, accountSoundPack, previewId: id === account ? null : id };
      set({ ...next, activeId: sync(next) });
    },
    endPreview: () => {
      const { accountId: account, accountSoundPack } = get();
      const next = { accountId: account, accountSoundPack, previewId: null };
      set({ ...next, activeId: sync(next) });
    },
  };
});

/** Modo (claro/escuro) do tema ativo, para o que não lê o CSS (ex.: o sonner). */
export function currentMode(): ThemeMode {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.mode === "light" ? "light" : "dark";
}

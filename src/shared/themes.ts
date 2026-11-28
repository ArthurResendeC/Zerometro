// Temas do Zerômetro: o registro que a loja, o servidor (posse) e o frontend compartilham.
// O visual de cada tema mora em src/web/themes/<id>.css; o contrato em docs/gamificacao/temas-contrato.md.

export const themeIds = ["cartucho", "minimal", "ladrao-fantasma"] as const;
export type ThemeId = (typeof themeIds)[number];

export const DEFAULT_THEME: ThemeId = "cartucho";

export type ThemeCategory = "retro" | "modern" | "iconic" | "exclusive";
/** Paleta: só cores. Completo: cores, fonte, forma, textura e sons. Lendário: + microtexto e celebrações. */
export type ThemeTier = "palette" | "complete" | "legendary";
export type ThemeMode = "dark" | "light";

export interface ThemeDef {
  id: ThemeId;
  name: string;
  description: string;
  category: ThemeCategory;
  tier: ThemeTier;
  /** Modos que o tema define; o primeiro é o padrão. */
  modes: readonly ThemeMode[];
  /** Cor da barra do navegador (<meta name="theme-color">) em cada modo. */
  themeColor: Partial<Record<ThemeMode, string>>;
  /** Folha de fontes (Google Fonts) carregada só quando o tema está ativo; null = as do tema base. */
  fontsHref: string | null;
  /** Ainda sem loja: só aparece na prévia de desenvolvimento. */
  devOnly: boolean;
}

export const themes: Record<ThemeId, ThemeDef> = {
  cartucho: {
    id: "cartucho",
    name: "Cartucho",
    description:
      "O clássico do Zerômetro: moldura em degrau, fonte pixelada e laranja de cartucho.",
    category: "retro",
    tier: "complete",
    modes: ["dark", "light"],
    themeColor: { dark: "#0f0e17", light: "#f6efdf" },
    fontsHref: null,
    devOnly: false,
  },
  minimal: {
    id: "minimal",
    name: "Minimal",
    description: "Limpo e moderno: cantos arredondados, sombras suaves e tipografia sem serifa.",
    category: "modern",
    tier: "complete",
    modes: ["dark"],
    themeColor: { dark: "#0e0f13" },
    fontsHref:
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
    devOnly: true,
  },
  "ladrao-fantasma": {
    id: "ladrao-fantasma",
    name: "Ladrão Fantasma",
    description: "Vermelho, preto e branco, painéis recortados e títulos inclinados. Roube a cena.",
    category: "iconic",
    tier: "legendary",
    modes: ["dark"],
    themeColor: { dark: "#0a0a0a" },
    fontsHref:
      "https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Semi+Condensed:wght@400;500;600;700&display=swap",
    devOnly: true,
  },
};

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (themeIds as readonly string[]).includes(value);
}

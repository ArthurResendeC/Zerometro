// Temas do Zerômetro: o registro que a loja, o servidor (posse) e o frontend compartilham.
// O visual de cada tema mora em src/web/themes/<id>.css; o contrato em docs/gamificacao/temas-contrato.md.

export const themeIds = [
  "cartucho",
  "minimal",
  "ladrao-fantasma",
  // retrô
  "fosforo",
  "tijolinho",
  "fliperama",
  "janela-azul",
  // modernos
  "minimal-claro",
  "alto-contraste",
  "caderno",
  // icônicos (homenagens: só paleta e atitude, sem nomes, logos, artes, sons ou fontes dos jogos)
  "costa-neon",
  "cinzas",
  "reino-esquecido",
  "noite-neon",
  "submundo",
  "pedra-antiga",
  "mesa-de-cartas",
  "fazendinha",
  "ilha",
  // exclusivos
  "platina",
  "abobora",
  "noite-feliz",
] as const;
export type ThemeId = (typeof themeIds)[number];

export const DEFAULT_THEME: ThemeId = "cartucho";

export const themeCategories = ["retro", "modern", "iconic", "exclusive"] as const;
export type ThemeCategory = (typeof themeCategories)[number];
/** Título de cada categoria na loja. */
export const themeCategoryLabels: Record<ThemeCategory, string> = {
  retro: "Retrô",
  modern: "Modernos",
  iconic: "Inspirados em jogos",
  exclusive: "Exclusivos",
};
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
  /** Amostra para a loja: fundo, superfície e destaque. */
  swatch: readonly [string, string, string];
  /** Folha de fontes (Google Fonts) carregada só quando o tema está ativo; null = as do tema base. */
  fontsHref: string | null;
  /** Tema sazonal: só fica à venda nestes meses (1 = janeiro). Quem comprou continua com ele. */
  season?: readonly number[];
}

const gf = (families: string) => `https://fonts.googleapis.com/css2?${families}&display=swap`;

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
    swatch: ["#0f0e17", "#7a7396", "#ff7a1a"],
    fontsHref: null,
  },
  minimal: {
    id: "minimal",
    name: "Minimal",
    description: "Limpo e moderno: cantos arredondados, sombras suaves e tipografia sem serifa.",
    category: "modern",
    tier: "complete",
    modes: ["dark"],
    themeColor: { dark: "#0e0f13" },
    swatch: ["#0e0f13", "#2e323c", "#7b88ff"],
    fontsHref:
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
  },
  "ladrao-fantasma": {
    id: "ladrao-fantasma",
    name: "Ladrão Fantasma",
    description: "Vermelho, preto e branco, painéis recortados e títulos inclinados. Roube a cena.",
    category: "iconic",
    tier: "legendary",
    modes: ["dark"],
    themeColor: { dark: "#0a0a0a" },
    swatch: ["#0b0b0b", "#f4f4f4", "#e5191c"],
    fontsHref:
      "https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Semi+Condensed:wght@400;500;600;700&display=swap",
  },
  fosforo: {
    id: "fosforo",
    name: "Fósforo",
    description:
      "Monitor de tubo: verde fosforescente no preto, linhas de varredura e brilho no texto.",
    category: "retro",
    tier: "complete",
    modes: ["dark"],
    themeColor: { dark: "#030a05" },
    swatch: ["#030a05", "#0b2a14", "#39ff7a"],
    fontsHref: null,
  },
  tijolinho: {
    id: "tijolinho",
    name: "Tijolinho",
    description: "Só quatro tons de verde-oliva, como a telinha do portátil de 1989.",
    category: "retro",
    tier: "palette",
    modes: ["light"],
    themeColor: { light: "#9bbc0f" },
    swatch: ["#9bbc0f", "#8bac0f", "#0f380f"],
    fontsHref: null,
  },
  fliperama: {
    id: "fliperama",
    name: "Fliperama",
    description: "Neon rosa e ciano no gabinete escuro, com brilho nas molduras. Insira uma ficha.",
    category: "retro",
    tier: "complete",
    modes: ["dark"],
    themeColor: { dark: "#07040f" },
    swatch: ["#07040f", "#1a0f33", "#ff2bd6"],
    fontsHref: null,
  },
  "janela-azul": {
    id: "janela-azul",
    name: "Janela Azul",
    description: "Caixas de menu em degradê azul com borda branca, como nos RPGs clássicos.",
    category: "retro",
    tier: "complete",
    modes: ["dark"],
    themeColor: { dark: "#050a24" },
    swatch: ["#050a24", "#2a46b8", "#ffffff"],
    fontsHref: gf("family=DotGothic16"),
  },
  "minimal-claro": {
    id: "minimal-claro",
    name: "Minimal Claro",
    description: "O Minimal de dia: fundo claro, cantos arredondados e sombras suaves.",
    category: "modern",
    tier: "palette",
    modes: ["light"],
    themeColor: { light: "#f5f6f8" },
    swatch: ["#f5f6f8", "#ffffff", "#4f5bd5"],
    fontsHref: gf("family=Inter:wght@400;500;600;700;800"),
  },
  "alto-contraste": {
    id: "alto-contraste",
    name: "Alto Contraste",
    description: "Preto, branco e amarelo, com letra grande e fonte feita para ler fácil. Grátis.",
    category: "modern",
    tier: "complete",
    modes: ["dark"],
    themeColor: { dark: "#000000" },
    swatch: ["#000000", "#ffffff", "#ffe600"],
    fontsHref: gf("family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400"),
  },
  caderno: {
    id: "caderno",
    name: "Caderno",
    description: "Diário de jogos: papel pautado, tinta azul e letra serifada.",
    category: "modern",
    tier: "complete",
    modes: ["light"],
    themeColor: { light: "#f4efe3" },
    swatch: ["#f4efe3", "#fffdf7", "#2445a8"],
    fontsHref: gf(
      "family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Lora:ital,wght@0,400;0,600;1,400",
    ),
  },
  "costa-neon": {
    id: "costa-neon",
    name: "Costa Neon",
    description:
      "Pôr do sol tropical: degradê rosa e laranja, vidro fosco e cantos bem arredondados.",
    category: "iconic",
    tier: "complete",
    modes: ["dark"],
    themeColor: { dark: "#120a24" },
    swatch: ["#120a24", "#2a1846", "#ff4f9a"],
    fontsHref: gf("family=Bebas+Neue&family=Manrope:wght@400;500;600;700;800"),
  },
  cinzas: {
    id: "cinzas",
    name: "Cinzas",
    description:
      "Ouro velho no escuro, letras de pedra gravada e nenhuma pressa. Prepare-se para desistir.",
    category: "iconic",
    tier: "complete",
    modes: ["dark"],
    themeColor: { dark: "#0c0b09" },
    swatch: ["#0c0b09", "#1a1814", "#c9a54a"],
    fontsHref: gf("family=Cinzel:wght@500;700&family=EB+Garamond:ital,wght@0,400;0,600;1,400"),
  },
  "reino-esquecido": {
    id: "reino-esquecido",
    name: "Reino Esquecido",
    description: "Um reino subterrâneo: preto azulado, branco pálido e molduras finas e delicadas.",
    category: "iconic",
    tier: "complete",
    modes: ["dark"],
    themeColor: { dark: "#070a11" },
    swatch: ["#070a11", "#121826", "#dfe8f5"],
    fontsHref: gf("family=Marcellus+SC&family=Alegreya+Sans:ital,wght@0,400;0,500;0,700;1,400"),
  },
  "noite-neon": {
    id: "noite-neon",
    name: "Noite Neon",
    description: "Cidade do futuro: amarelo de alerta, ciano, cantos cortados e títulos com falha.",
    category: "iconic",
    tier: "complete",
    modes: ["dark"],
    themeColor: { dark: "#08080e" },
    swatch: ["#08080e", "#14141f", "#fcee0a"],
    fontsHref: gf("family=Rajdhani:wght@500;600;700"),
  },
  submundo: {
    id: "submundo",
    name: "Submundo",
    description: "Fuja do submundo: vermelho de brasa, dourado e gregas nas bordas.",
    category: "iconic",
    tier: "complete",
    modes: ["dark"],
    themeColor: { dark: "#120608" },
    swatch: ["#120608", "#24100f", "#ff5a36"],
    fontsHref: gf("family=Forum&family=Spectral:ital,wght@0,400;0,600;1,400"),
  },
  "pedra-antiga": {
    id: "pedra-antiga",
    name: "Pedra Antiga",
    description: "Tecnologia ancestral: ardósia escura e traços turquesa que brilham.",
    category: "iconic",
    tier: "complete",
    modes: ["dark"],
    themeColor: { dark: "#0a1216" },
    swatch: ["#0a1216", "#122028", "#4fe3f0"],
    fontsHref: gf("family=Exo+2:ital,wght@0,400;0,500;0,600;0,700;1,400"),
  },
  "mesa-de-cartas": {
    id: "mesa-de-cartas",
    name: "Mesa de Cartas",
    description:
      "Feltro verde-azulado, naipes de baralho, fichas vermelhas e azuis e fonte de pixel.",
    category: "iconic",
    tier: "complete",
    modes: ["dark"],
    themeColor: { dark: "#16302e" },
    swatch: ["#16302e", "#2a4645", "#fe5f55"],
    // Fonte própria (Thin Sans, CC0), declarada no CSS do tema: não vem do Google Fonts.
    fontsHref: null,
  },
  fazendinha: {
    id: "fazendinha",
    name: "Fazendinha",
    description: "Vida no campo: pergaminho, molduras de madeira e tons quentes de fim de tarde.",
    category: "iconic",
    tier: "complete",
    modes: ["light"],
    themeColor: { light: "#e9c891" },
    swatch: ["#e9c891", "#fbe8c0", "#b8541c"],
    fontsHref: gf(
      "family=Pixelify+Sans:wght@500;600;700&family=Merriweather:ital,wght@0,400;0,700;1,400",
    ),
  },
  ilha: {
    id: "ilha",
    name: "Ilha",
    description: "Férias na ilha: pastel, tudo redondinho e botões que quicam.",
    category: "iconic",
    tier: "complete",
    modes: ["light"],
    themeColor: { light: "#f7f1df" },
    swatch: ["#f7f1df", "#fffcf2", "#0d7f6e"],
    fontsHref: gf("family=Nunito:ital,wght@0,500;0,700;0,800;0,900;1,500"),
  },
  platina: {
    id: "platina",
    name: "Platina",
    description: "Para quem platina: prata polida, troféus e um brilho metálico nas molduras.",
    category: "exclusive",
    tier: "complete",
    modes: ["dark"],
    themeColor: { dark: "#0b0d12" },
    swatch: ["#0b0d12", "#1b1f29", "#d9e1ee"],
    fontsHref: gf("family=Sora:wght@400;500;600;700;800"),
  },
  abobora: {
    id: "abobora",
    name: "Abóbora",
    description:
      "Tema de Halloween: laranja de abóbora, roxo de bruxa e verde de poção. Só em outubro.",
    category: "exclusive",
    tier: "complete",
    modes: ["dark"],
    themeColor: { dark: "#0f0a14" },
    swatch: ["#0f0a14", "#22172d", "#ff8a1f"],
    fontsHref: gf("family=Creepster&family=Grandstander:wght@400;500;600;700"),
    season: [10],
  },
  "noite-feliz": {
    id: "noite-feliz",
    name: "Noite Feliz",
    description:
      "Tema de Natal: verde pinheiro, vermelho de laço, dourado e neve caindo. Só em dezembro.",
    category: "exclusive",
    tier: "complete",
    modes: ["dark"],
    themeColor: { dark: "#06140e" },
    swatch: ["#06140e", "#0e2a1d", "#e8343f"],
    fontsHref: gf("family=Mountains+of+Christmas:wght@700&family=Quicksand:wght@400;500;600;700"),
    season: [12],
  },
};
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (themeIds as readonly string[]).includes(value);
}

/** Temas de graça para todo mundo: o base e o de acessibilidade. */
export const freeThemeIds: readonly ThemeId[] = [DEFAULT_THEME, "alto-contraste"];

/** O tema sazonal está na temporada em `now`, no fuso do perfil? Os sem temporada sempre estão. */
export function inSeason(id: ThemeId, now: Date, timeZone?: string): boolean {
  const season = themes[id].season;
  if (!season) return true;
  const month = Number(
    new Intl.DateTimeFormat("en-US", { month: "numeric", timeZone }).format(now),
  );
  return season.includes(month);
}

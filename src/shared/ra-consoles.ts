// Plataformas do IGDB → consoles do RetroAchievements. O IGDB guarda a abreviação da plataforma
// (ou o nome, quando não há abreviação), então cada console lista os dois e algumas variações.
// Ids de API_GetConsoleIDs (o `mise run achievements:smoke` confere contra a API real).

export interface RaConsole {
  id: number;
  name: string;
  /** Abreviações e nomes do IGDB que caem neste console. */
  aliases: string[];
}

export const RA_CONSOLES: RaConsole[] = [
  { id: 1, name: "Genesis/Mega Drive", aliases: ["Genesis/MegaDrive", "Sega Mega Drive/Genesis"] },
  { id: 2, name: "Nintendo 64", aliases: ["N64", "Nintendo 64"] },
  {
    id: 3,
    name: "SNES/Super Famicom",
    aliases: ["SNES", "Super Nintendo Entertainment System", "SFAM", "Super Famicom"],
  },
  { id: 4, name: "Game Boy", aliases: ["GB", "Game Boy"] },
  { id: 5, name: "Game Boy Advance", aliases: ["GBA", "Game Boy Advance"] },
  { id: 6, name: "Game Boy Color", aliases: ["GBC", "Game Boy Color"] },
  {
    id: 7,
    name: "NES/Famicom",
    aliases: [
      "NES",
      "Nintendo Entertainment System",
      "Famicom",
      "FDS",
      "Family Computer Disk System",
    ],
  },
  {
    id: 8,
    name: "PC Engine/TurboGrafx-16",
    aliases: ["TG16", "TurboGrafx-16/PC Engine", "PC Engine SuperGrafx", "SuperGrafx"],
  },
  { id: 9, name: "Sega CD", aliases: ["Sega CD", "SegaCD", "Mega-CD", "Sega CD/Mega-CD"] },
  { id: 10, name: "32X", aliases: ["Sega32", "Sega 32X", "32X"] },
  {
    id: 11,
    name: "Master System",
    aliases: ["SMS", "Sega Master System/Mark III", "Sega Master System"],
  },
  { id: 12, name: "PlayStation", aliases: ["PS1", "PS", "PlayStation"] },
  { id: 13, name: "Atari Lynx", aliases: ["Lynx", "Atari Lynx"] },
  {
    id: 14,
    name: "Neo Geo Pocket",
    aliases: ["NGP", "NGPC", "Neo Geo Pocket", "Neo Geo Pocket Color"],
  },
  { id: 15, name: "Game Gear", aliases: ["Game Gear", "GG", "Sega Game Gear"] },
  { id: 16, name: "GameCube", aliases: ["NGC", "GCN", "Nintendo GameCube", "GameCube"] },
  { id: 17, name: "Atari Jaguar", aliases: ["Jaguar", "Atari Jaguar"] },
  { id: 18, name: "Nintendo DS", aliases: ["NDS", "DS", "Nintendo DS"] },
  { id: 21, name: "PlayStation 2", aliases: ["PS2", "PlayStation 2"] },
  {
    id: 23,
    name: "Magnavox Odyssey 2",
    aliases: ["Odyssey 2", "Odyssey 2/Videopac G7000", "Magnavox Odyssey 2"],
  },
  { id: 24, name: "Pokemon Mini", aliases: ["Pokémon mini", "Pokemon mini"] },
  { id: 25, name: "Atari 2600", aliases: ["Atari2600", "Atari 2600"] },
  { id: 27, name: "Arcade", aliases: ["Arcade"] },
  { id: 28, name: "Virtual Boy", aliases: ["VB", "Virtual Boy"] },
  { id: 29, name: "MSX", aliases: ["MSX", "MSX2"] },
  { id: 33, name: "SG-1000", aliases: ["SG1000", "SG-1000"] },
  { id: 37, name: "Amstrad CPC", aliases: ["CPC", "Amstrad CPC"] },
  { id: 38, name: "Apple II", aliases: ["Apple II", "Apple][", "AppleII"] },
  { id: 39, name: "Saturn", aliases: ["Saturn", "Sega Saturn"] },
  { id: 40, name: "Dreamcast", aliases: ["DC", "Dreamcast"] },
  { id: 41, name: "PlayStation Portable", aliases: ["PSP", "PlayStation Portable"] },
  { id: 43, name: "3DO Interactive Multiplayer", aliases: ["3DO", "3DO Interactive Multiplayer"] },
  { id: 44, name: "ColecoVision", aliases: ["ColecoVision"] },
  { id: 45, name: "Intellivision", aliases: ["Intellivision"] },
  { id: 46, name: "Vectrex", aliases: ["Vectrex"] },
  { id: 47, name: "PC-8000/8800", aliases: ["PC-8801", "PC-8800", "PC-8000"] },
  { id: 49, name: "PC-FX", aliases: ["PC-FX"] },
  { id: 51, name: "Atari 7800", aliases: ["Atari7800", "Atari 7800"] },
  { id: 53, name: "WonderSwan", aliases: ["WonderSwan", "WonderSwan Color"] },
  { id: 56, name: "Neo Geo CD", aliases: ["Neo Geo CD"] },
  { id: 57, name: "Fairchild Channel F", aliases: ["Fairchild Channel F", "Channel F"] },
  {
    id: 76,
    name: "PC Engine CD/TurboGrafx-CD",
    aliases: ["Turbografx-16/PC Engine CD", "TurboGrafx-CD", "PC Engine CD"],
  },
  { id: 77, name: "Atari Jaguar CD", aliases: ["Atari Jaguar CD", "Jaguar CD"] },
  { id: 78, name: "Nintendo DSi", aliases: ["DSi", "Nintendo DSi"] },
];

const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const byAlias = new Map(
  RA_CONSOLES.flatMap((console) => console.aliases.map((alias) => [key(alias), console] as const)),
);

/** Os consoles do RA das plataformas do jogo no IGDB, sem repetir. */
export function raConsolesFor(platforms: string[]): RaConsole[] {
  const found = new Map<number, RaConsole>();
  for (const platform of platforms) {
    const console = byAlias.get(key(platform));
    if (console) found.set(console.id, console);
  }
  return [...found.values()];
}

export function findRaConsole(id: number): RaConsole | null {
  return RA_CONSOLES.find((c) => c.id === id) ?? null;
}

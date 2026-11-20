// Jogos do banco de demonstração: metadados reais do IGDB, congelados aqui para o seed não
// depender de credenciais. Usado por `seed-demo.ts` e por `capture-demo-games.ts`.

export type GameRow = [
  igdbId: number,
  name: string,
  slug: string,
  coverImageId: string,
  releaseYear: number,
  ttbMainSec: number | null,
  ttbExtraSec: number | null,
  ttbCompleteSec: number | null,
  platforms: string[],
  genres: string[],
];

// prettier-ignore
export const GAMES = {
  eldenRing: [119133, "Elden Ring", "elden-ring", "co4jni", 2022, 156960, 420631, 623880, ["Series X|S", "PS4", "Switch 2", "PC", "PS5", "XONE"], ["Role-playing (RPG)", "Adventure"]],
  clairObscur: [305152, "Clair Obscur: Expedition 33", "clair-obscur-expedition-33", "co9gam", 2025, 105784, 147738, 283984, ["Series X|S", "PC", "PS5"], ["Role-playing (RPG)", "Turn-based strategy (TBS)", "Adventure", "Indie"]],
  silksong: [115289, "Hollow Knight: Silksong", "hollow-knight-silksong", "cobebu", 2025, 61714, 185400, 295200, ["Series X|S", "PS4", "Linux", "Switch 2", "PC", "PS5", "Mac", "XONE", "Switch"], ["Platform", "Adventure", "Indie"]],
  persona5: [114283, "Persona 5 Royal", "persona-5-royal", "coclf1", 2019, 315000, 424580, 799200, ["Series X|S", "PS4", "PC", "PS5", "XONE", "Switch"], ["Role-playing (RPG)", "Adventure"]],
  bg3: [119171, "Baldur's Gate III", "baldurs-gate-iii", "co670h", 2023, 461454, 475420, 20338705, ["Stadia", "Series X|S", "Linux", "PC", "PS5", "Mac"], ["Role-playing (RPG)", "Strategy", "Turn-based strategy (TBS)", "Adventure"]],
  zeldaTotk: [119388, "The Legend of Zelda: Tears of the Kingdom", "the-legend-of-zelda-tears-of-the-kingdom", "co5vmg", 2023, 198564, 420424, 634834, ["Switch"], ["Puzzle", "Adventure"]],
  discoElysium: [26472, "Disco Elysium", "disco-elysium", "co1sfj", 2019, 68400, 119290, 160400, ["PC", "Mac"], ["Role-playing (RPG)", "Adventure", "Indie"]],
  outerWilds: [11737, "Outer Wilds", "outer-wilds", "co65ac", 2019, 43200, 68400, 214200, ["Series X|S", "PS4", "PC", "PS5", "XONE", "Switch"], ["Puzzle", "Simulator", "Adventure", "Indie"]],
  hollowKnight: [14593, "Hollow Knight", "hollow-knight", "cobfzp", 2017, 56274, 130340, 257248, ["Series X|S", "PS4", "Linux", "Switch 2", "PC", "PS5", "Mac", "WiiU", "XONE", "Switch"], ["Platform", "Adventure", "Indie"]],
  celeste: [26226, "Celeste", "celeste", "cob9dh", 2018, 38296, 76556, 195750, ["Stadia", "PS4", "Linux", "PC", "Mac", "XONE", "Switch"], ["Platform", "Adventure", "Indie"]],
  hades: [113112, "Hades", "hades--1", "cob9kr", 2020, 139240, 253600, 542700, ["Series X|S", "PS4", "PC", "iOS", "PS5", "Mac", "XONE", "Switch"], ["Role-playing (RPG)", "Hack and slash/Beat 'em up", "Adventure", "Indie"]],
  stardew: [17000, "Stardew Valley", "stardew-valley", "coa93h", 2016, 180000, 324000, 747900, ["PS4", "Linux", "Switch 2", "Android", "PC", "iOS", "Mac", "WiiU", "Vita", "XONE", "Switch"], ["Role-playing (RPG)", "Simulator", "Strategy", "Adventure", "Indie"]],
  deathStranding: [19564, "Death Stranding", "death-stranding", "cocsvh", 2019, 131142, 217614, 449808, ["PS4", "PC"], ["Shooter", "Role-playing (RPG)", "Adventure"]],
  witcher3: [1942, "The Witcher 3: Wild Hunt", "the-witcher-3-wild-hunt", "coaarl", 2015, 134552, 254778, 579755, ["Series X|S", "PS4", "Switch 2", "PC", "PS5", "XONE", "Switch"], ["Role-playing (RPG)", "Adventure"]],
  rdr2: [25076, "Red Dead Redemption 2", "red-dead-redemption-2", "co1q1f", 2018, 175371, 322200, 749781, ["Stadia", "PS4", "PC", "XONE"], ["Shooter", "Role-playing (RPG)", "Adventure"]],
  sekiro: [76882, "Sekiro: Shadows Die Twice", "sekiro-shadows-die-twice", "co2a23", 2019, 78480, 149850, 190285, ["Stadia", "PS4", "PC", "XONE"], ["Adventure"]],
  chronoTrigger: [1802, "Chrono Trigger", "chrono-trigger", "co3plw", 1995, 63000, 105075, 162000, ["Satellaview", "SNES", "Wii", "SFAM"], ["Role-playing (RPG)"]],
  hades2: [228525, "Hades II", "hades-ii", "coaknx", 2025, null, 154800, 314400, ["Series X|S", "Switch 2", "PC", "PS5", "Mac", "Switch"], ["Role-playing (RPG)", "Hack and slash/Beat 'em up", "Adventure", "Indie"]],
  metroidPrime4: [37136, "Metroid Prime 4: Beyond", "metroid-prime-4-beyond", "cob9xh", 2025, null, 49500, 64800, ["Switch 2", "Switch"], ["Shooter", "Platform", "Adventure"]],
  gta6: [52189, "Grand Theft Auto VI", "grand-theft-auto-vi", "cocv1v", 2026, null, null, null, ["Series X|S", "PS5"], ["Shooter", "Racing", "Adventure"]],
} satisfies Record<string, GameRow>;

export type GameKey = keyof typeof GAMES;

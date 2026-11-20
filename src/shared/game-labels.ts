import type { AgeRatingOrg, GameLinkKind, GameReleaseStatus } from "./game-page";

// Rótulos em português para os dados da página do jogo. Temas, modos e perspectivas são
// listas fechadas do IGDB (endpoints /themes, /game_modes, /player_perspectives); o nome
// original fica nos dados e a tradução é só na exibição, como em `genres.ts`. Valor novo no
// IGDB aparece em inglês até entrar aqui.

const THEME_LABELS: Record<string, string> = {
  Action: "Ação",
  Fantasy: "Fantasia",
  "Science fiction": "Ficção científica",
  Horror: "Terror",
  Thriller: "Suspense",
  Survival: "Sobrevivência",
  Historical: "Histórico",
  Stealth: "Furtividade",
  Comedy: "Comédia",
  Business: "Negócios",
  Drama: "Drama",
  "Non-fiction": "Não ficção",
  Sandbox: "Sandbox",
  Educational: "Educativo",
  Kids: "Infantil",
  "Open world": "Mundo aberto",
  Warfare: "Guerra",
  Party: "Party game",
  "4X (explore, expand, exploit, and exterminate)": "4X",
  Erotic: "Erótico",
  Mystery: "Mistério",
  Romance: "Romance",
};

const GAME_MODE_LABELS: Record<string, string> = {
  "Single player": "Um jogador",
  Multiplayer: "Multijogador",
  "Co-operative": "Cooperativo",
  "Split screen": "Tela dividida",
  "Massively Multiplayer Online (MMO)": "MMO",
  "Battle Royale": "Battle royale",
};

const PERSPECTIVE_LABELS: Record<string, string> = {
  "First person": "Primeira pessoa",
  "Third person": "Terceira pessoa",
  "Bird view / Isometric": "Isométrica / vista de cima",
  "Side view": "Visão lateral",
  Text: "Texto",
  Auditory: "Áudio",
  "Virtual Reality": "Realidade virtual",
};

export function themeLabel(igdbName: string): string {
  return THEME_LABELS[igdbName] ?? igdbName;
}

export function gameModeLabel(igdbName: string): string {
  return GAME_MODE_LABELS[igdbName] ?? igdbName;
}

export function perspectiveLabel(igdbName: string): string {
  return PERSPECTIVE_LABELS[igdbName] ?? igdbName;
}

export const gameReleaseStatusLabels: Record<GameReleaseStatus, string> = {
  alpha: "Alfa",
  beta: "Beta",
  early_access: "Acesso antecipado",
  offline: "Fora do ar",
  cancelled: "Cancelado",
  rumored: "Rumor",
  delisted: "Removido das lojas",
};

export const gameLinkLabels: Record<GameLinkKind, string> = {
  steam: "Steam",
  playstation: "PlayStation Store",
  xbox: "Xbox Store",
  nintendo: "Nintendo eShop",
  epic: "Epic Games Store",
  gog: "GOG",
  itch: "itch.io",
  gamejolt: "Game Jolt",
  app_store: "App Store",
  google_play: "Google Play",
  official: "Site oficial",
  wiki: "Wiki",
  wikipedia: "Wikipédia",
  reddit: "Reddit",
  discord: "Discord",
  youtube: "YouTube",
  twitch: "Twitch",
  twitter: "X (Twitter)",
  bluesky: "Bluesky",
  instagram: "Instagram",
  facebook: "Facebook",
};

export const ageRatingOrgLabels: Record<AgeRatingOrg, string> = {
  classind: "ClassInd",
  pegi: "PEGI",
  esrb: "ESRB",
};

/** Idiomas do IGDB (endpoint /languages, lista fechada), em ordem de exibição. */
const LANGUAGE_LABELS: Record<string, string> = {
  "Portuguese (Brazil)": "Português (Brasil)",
  "Portuguese (Portugal)": "Português (Portugal)",
  English: "Inglês",
  "English (UK)": "Inglês (Reino Unido)",
  "Spanish (Spain)": "Espanhol (Espanha)",
  "Spanish (Mexico)": "Espanhol (América Latina)",
  French: "Francês",
  German: "Alemão",
  Italian: "Italiano",
  Japanese: "Japonês",
  Korean: "Coreano",
  "Chinese (Simplified)": "Chinês (simplificado)",
  "Chinese (Traditional)": "Chinês (tradicional)",
  Russian: "Russo",
  Polish: "Polonês",
  Turkish: "Turco",
  Arabic: "Árabe",
  Czech: "Tcheco",
  Danish: "Dinamarquês",
  Dutch: "Holandês",
  Finnish: "Finlandês",
  Hebrew: "Hebraico",
  Hungarian: "Húngaro",
  Norwegian: "Norueguês",
  Swedish: "Sueco",
  Thai: "Tailandês",
  Vietnamese: "Vietnamita",
  Ukrainian: "Ucraniano",
};

export function languageLabel(igdbName: string): string {
  return LANGUAGE_LABELS[igdbName] ?? igdbName;
}

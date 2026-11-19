// Gêneros do IGDB (endpoint /genres, que é uma lista fechada) em português. O banco guarda o
// nome original; a tradução é só na exibição. Gênero novo no IGDB aparece em inglês até
// entrar aqui.

const GENRE_LABELS: Record<string, string> = {
  Adventure: "Aventura",
  Arcade: "Arcade",
  "Card & Board Game": "Cartas e tabuleiro",
  Fighting: "Luta",
  "Hack and slash/Beat 'em up": "Hack and slash / Beat 'em up",
  Indie: "Indie",
  MOBA: "MOBA",
  Music: "Música",
  Pinball: "Pinball",
  Platform: "Plataforma",
  "Point-and-click": "Point-and-click",
  Puzzle: "Quebra-cabeça",
  "Quiz/Trivia": "Quiz",
  Racing: "Corrida",
  "Real Time Strategy (RTS)": "Estratégia em tempo real",
  "Role-playing (RPG)": "RPG",
  Shooter: "Tiro",
  Simulator: "Simulação",
  Sport: "Esporte",
  Strategy: "Estratégia",
  Tactical: "Tático",
  "Turn-based strategy (TBS)": "Estratégia por turnos",
  "Visual Novel": "Visual novel",
};

export function genreLabel(igdbName: string): string {
  return GENRE_LABELS[igdbName] ?? igdbName;
}

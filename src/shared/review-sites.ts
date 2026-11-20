// Links para conferir as notas de um jogo em outros sites. Não temos o id do jogo neles
// (o IGDB não guarda), então os links são buscas pelo nome.

/** Busca do Metacritic só em jogos (`category=13`). */
export function metacriticSearchUrl(name: string): string {
  return `https://www.metacritic.com/search/${encodeURIComponent(name)}/?category=13`;
}

/**
 * O OpenCritic não tem busca por endereço (a busca do site leva direto ao primeiro resultado),
 * então é uma busca na web restrita às páginas de jogo dele. O ano separa remake e original.
 */
export function openCriticSearchUrl(name: string, releaseYear: number | null): string {
  const query = ["site:opencritic.com/game", name, releaseYear].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

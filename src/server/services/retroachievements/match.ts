import type { RaGameListEntry } from "./index";

// Acha o jogo do IGDB na lista de um console do RA pelo nome. É só uma sugestão: o usuário
// confirma na interface. Os títulos do RA têm convenções próprias: "Legend of Zelda, The - A
// Link to the Past", nomes alternativos com " | ", marcadores "~Hack~" e subsets "[Subset - …]".

/** Marcadores de jogos que não são o original (hacks, homebrew, demos, kits de teste). */
const EXCLUDED_TAGS = /~(hack|homebrew|demo|test kit|z)~/i;
const SUBSET = /\[subset\s*-\s*[^\]]*\]/i;
/** Abaixo disso não parece o mesmo jogo. */
const MIN_SCORE = 0.5;

export interface RaMatch extends RaGameListEntry {
  score: number;
  /** Lista extra do jogo ("[Subset - Bonus]"): opção a mais, depois da principal. */
  subset: boolean;
}

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/~[^~]*~/g, " ")
    .replace(SUBSET, " ")
    .replace(/&/g, " and ")
    .replace(/,\s*the\b/g, " ")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Quanto dois nomes já normalizados se parecem (0..1): iguais, um contém o outro ou palavras em comum. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  if (longer.startsWith(`${shorter} `) || longer.includes(` ${shorter} `)) {
    return 0.6 + 0.35 * (shorter.length / longer.length);
  }
  const wordsA = new Set(a.split(" "));
  const wordsB = new Set(b.split(" "));
  const common = [...wordsA].filter((w) => wordsB.has(w)).length;
  return (2 * common) / (wordsA.size + wordsB.size);
}

/** Os jogos do RA mais parecidos com o nome, do melhor para o pior (subsets depois da principal). */
export function matchRaGames(name: string, games: RaGameListEntry[], limit = 8): RaMatch[] {
  const target = normalizeTitle(name);
  const matches: RaMatch[] = [];
  for (const game of games) {
    if (EXCLUDED_TAGS.test(game.title)) continue;
    const score = Math.max(
      ...game.title.split(" | ").map((alt) => similarity(target, normalizeTitle(alt))),
    );
    if (score < MIN_SCORE) continue;
    matches.push({ ...game, score, subset: SUBSET.test(game.title) });
  }
  return matches
    .toSorted(
      (a, b) =>
        b.score - a.score || Number(a.subset) - Number(b.subset) || b.achievements - a.achievements,
    )
    .slice(0, limit);
}

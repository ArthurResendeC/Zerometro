import { describe, expect, test } from "bun:test";
import { metacriticSearchUrl, openCriticSearchUrl } from "./review-sites";

describe("links para outros sites de notas", () => {
  test("Metacritic: busca só em jogos, com o nome escapado", () => {
    expect(metacriticSearchUrl("The Legend of Zelda: Ocarina of Time")).toBe(
      "https://www.metacritic.com/search/The%20Legend%20of%20Zelda%3A%20Ocarina%20of%20Time/?category=13",
    );
    expect(metacriticSearchUrl("Fate/Stay Night")).toContain("/search/Fate%2FStay%20Night/");
  });

  test("OpenCritic: busca na web restrita às páginas de jogo, com o ano quando houver", () => {
    expect(openCriticSearchUrl("Elden Ring", 2022)).toBe(
      "https://www.google.com/search?q=site%3Aopencritic.com%2Fgame%20Elden%20Ring%202022",
    );
    expect(openCriticSearchUrl("Fable", null)).toBe(
      "https://www.google.com/search?q=site%3Aopencritic.com%2Fgame%20Fable",
    );
  });
});

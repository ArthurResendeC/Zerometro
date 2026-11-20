import { describe, expect, test } from "bun:test";
import { fakeRaGame } from "../../testing";
import { raConsolesFor } from "../../../shared/ra-consoles";
import { matchRaGames, normalizeTitle } from "./match";

describe("normalizeTitle", () => {
  test("ignora acentos, artigo, pontuação e marcadores do RA", () => {
    expect(normalizeTitle("Legend of Zelda, The: A Link to the Past")).toBe(
      "legend of zelda a link to past",
    );
    expect(normalizeTitle("The Legend of Zelda: A Link to the Past")).toBe(
      "legend of zelda a link to past",
    );
    expect(normalizeTitle("Pokémon Red & Blue")).toBe("pokemon red and blue");
    expect(normalizeTitle("Super Metroid [Subset - Bonus]")).toBe("super metroid");
  });
});

describe("matchRaGames", () => {
  const games = [
    fakeRaGame({ id: 1, title: "Super Metroid" }),
    fakeRaGame({ id: 2, title: "Super Metroid [Subset - Bonus]" }),
    fakeRaGame({ id: 3, title: "~Hack~ Super Metroid: Redesign" }),
    fakeRaGame({ id: 4, title: "~Homebrew~ Metroid Clone" }),
    fakeRaGame({ id: 5, title: "Metroid Fusion" }),
    fakeRaGame({ id: 6, title: "Super Mario World" }),
    fakeRaGame({ id: 7, title: "Rockman X | Mega Man X" }),
  ];

  test("o nome igual primeiro, subset logo depois; hacks e homebrew fora", () => {
    const ids = matchRaGames("Super Metroid", games).map((m) => [m.id, m.subset]);
    expect(ids.slice(0, 2)).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(ids.map(([id]) => id)).not.toContain(3);
    expect(ids.map(([id]) => id)).not.toContain(4);
    expect(ids.map(([id]) => id)).not.toContain(6);
  });

  test("acha pelo nome alternativo e com o artigo trocado de lugar", () => {
    expect(matchRaGames("Mega Man X", games)[0]?.id).toBe(7);
    const zelda = [fakeRaGame({ id: 9, title: "Legend of Zelda, The: A Link to the Past" })];
    expect(matchRaGames("The Legend of Zelda: A Link to the Past", zelda)[0]?.score).toBe(1);
  });

  test("nada parecido → vazio", () => {
    expect(matchRaGames("Celeste", games)).toEqual([]);
  });
});

describe("raConsolesFor", () => {
  test("abreviações e nomes do IGDB viram consoles do RA, sem repetir", () => {
    expect(raConsolesFor(["SNES", "Super Famicom", "PC", "Wii"]).map((c) => c.id)).toEqual([3]);
    expect(raConsolesFor(["Genesis/MegaDrive", "PS1"]).map((c) => c.id)).toEqual([1, 12]);
    expect(raConsolesFor(["PS5", "Switch"])).toEqual([]);
  });
});
